//! The DIG SITE lobby and match state machine.
//!
//! Pure logic: every method takes what it needs (ids, the time, a seed) and returns
//! the messages to send, so the whole flow is testable without sockets.
//!
//! Flow: Lobby -> Running (host presses start) -> Results -> Lobby (anyone presses
//! "back to lobby"). Players cannot join while a match is running. A player who
//! disconnects mid-match keeps their score for the results screen.
//!
//! Secrecy: the only messages that describe the map are `dg_map` (surface items
//! only) and the result of a dig. A struck line is revealed in the `dg_dig`
//! message for that strike, and never before.

use std::collections::HashMap;

use super::layout::{self, Layout, Tile};
use super::rules::{DigOutcome, DigState};
use server_core::json::Json;
use server_core::Delivery;

pub const MIN_PLAYERS: usize = 2;
pub const MAX_PLAYERS: usize = 8;
pub const MATCH_SECONDS: f64 = 480.0;
/// How far (in metres) a dig tile may be from where the player stands: the 3 m reach plus slack for lag.
pub const DIG_REACH_M: f64 = 4.5;
/// The map is centred on the world origin: tile index = world metres + half the width.
const HALF_WIDTH: f64 = layout::WIDTH as f64 / 2.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    /// Everyone connected to the lobby.
    All,
    One(u32),
}

#[derive(Debug, Clone)]
pub struct Out {
    pub to: Target,
    pub message: Json,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Phase {
    Lobby,
    Running { ends_at: f64 },
    Results,
}

struct Member {
    id: u32,
    name: String,
    /// Disconnected during a match: kept for the results screen.
    left: bool,
    /// Last reported position in tile space (metres from the grid's corner).
    position: Option<(f64, f64)>,
}

pub struct DigLobby {
    phase: Phase,
    members: Vec<Member>,
    host: Option<u32>,
    game: Option<DigState>,
    queue: Vec<(u32, Tile)>,
    /// Match length in seconds; MATCH_SECONDS unless a test or an operator shortens it.
    duration: f64,
    /// A private one-player game (the SANDBOX menu's solo DIG SITE): it starts at once and has no lobby.
    solo: bool,
}

impl Default for DigLobby {
    fn default() -> Self {
        Self::new()
    }
}

impl DigLobby {
    pub fn new() -> Self {
        Self::with_duration(MATCH_SECONDS)
    }

    pub fn with_duration(duration: f64) -> Self {
        DigLobby {
            phase: Phase::Lobby,
            members: Vec::new(),
            host: None,
            game: None,
            queue: Vec::new(),
            duration,
            solo: false,
        }
    }

    /// A private game for one player. The caller joins and starts it straight away.
    pub fn solo(duration: f64) -> Self {
        DigLobby {
            solo: true,
            ..Self::with_duration(duration)
        }
    }

    fn min_players(&self) -> usize {
        if self.solo {
            1
        } else {
            MIN_PLAYERS
        }
    }

    fn max_players(&self) -> usize {
        if self.solo {
            1
        } else {
            MAX_PLAYERS
        }
    }

    /// Connected members, in join order.
    pub fn member_ids(&self) -> Vec<u32> {
        self.members
            .iter()
            .filter(|member| !member.left)
            .map(|member| member.id)
            .collect()
    }

    pub fn is_member(&self, id: u32) -> bool {
        self.members
            .iter()
            .any(|member| member.id == id && !member.left)
    }

    pub fn is_running(&self) -> bool {
        matches!(self.phase, Phase::Running { .. })
    }

    pub fn join(&mut self, id: u32, name: &str) -> Vec<Out> {
        if self.is_member(id) {
            return Vec::new();
        }
        if self.is_running() {
            return vec![error(id, "in-progress")];
        }
        if self.member_ids().len() >= self.max_players() {
            return vec![error(id, "full")];
        }
        if self
            .members
            .iter()
            .any(|member| !member.left && member.name.eq_ignore_ascii_case(name))
        {
            return vec![error(id, "name-taken")];
        }
        self.members.push(Member {
            id,
            name: name.to_owned(),
            left: false,
            position: None,
        });
        if self.host.is_none() {
            self.host = Some(id);
        }
        vec![self.lobby_message()]
    }

    pub fn leave(&mut self, id: u32) -> Vec<Out> {
        if !self.is_member(id) {
            return Vec::new();
        }
        if self.is_running() {
            if let Some(member) = self.members.iter_mut().find(|member| member.id == id) {
                member.left = true;
            }
        } else {
            self.members.retain(|member| member.id != id);
        }
        self.queue.retain(|(player, _)| *player != id);
        if self.host == Some(id) {
            self.host = self.member_ids().first().copied();
        }
        if self.member_ids().is_empty() {
            self.reset();
            return Vec::new();
        }
        vec![self.lobby_message()]
    }

    /// The host starts the match with a seed. Returns each player's map message, or an error for the sender.
    pub fn start(&mut self, id: u32, seed: u64, now: f64) -> Vec<Out> {
        self.start_with(id, now, || layout::generate(seed))
    }

    fn start_with(&mut self, id: u32, now: f64, make_layout: impl FnOnce() -> Layout) -> Vec<Out> {
        if self.host != Some(id) || !self.is_member(id) {
            return vec![error(id, "not-host")];
        }
        if self.phase != Phase::Lobby {
            return vec![error(id, "in-progress")];
        }
        if self.member_ids().len() < self.min_players() {
            return vec![error(id, "too-few")];
        }

        let layout = make_layout();
        let mut state = DigState::new(layout);
        let ids = self.member_ids();
        for &player in &ids {
            state.add_player(player);
        }
        let surface = surface_json(state.layout());
        let spawns = state.layout().spawns.clone();
        let players = self.players_json();
        let outs = ids
            .iter()
            .enumerate()
            .map(|(index, &player)| {
                let spawn = spawns[index % spawns.len()];
                let message = Json::obj([
                    ("t", Json::str("dg_map")),
                    ("duration", Json::num(self.duration)),
                    ("solo", Json::Bool(self.solo)),
                    (
                        "spawn",
                        Json::Arr(vec![Json::num(spawn.0), Json::num(spawn.1)]),
                    ),
                    ("map", surface.clone()),
                    ("players", players.clone()),
                ]);
                Out {
                    to: Target::One(player),
                    message,
                }
            })
            .collect();

        self.game = Some(state);
        self.queue.clear();
        for member in &mut self.members {
            member.position = None;
        }
        self.phase = Phase::Running {
            ends_at: now + self.duration,
        };
        outs
    }

    /// Remember where a player stands, given in world metres (the map is centred on the origin).
    pub fn position(&mut self, id: u32, world_x: f64, world_z: f64) {
        if let Some(member) = self
            .members
            .iter_mut()
            .find(|member| member.id == id && !member.left)
        {
            if world_x.is_finite() && world_z.is_finite() {
                member.position = Some((world_x + HALF_WIDTH, world_z + HALF_WIDTH));
            }
        }
    }

    /// Queue a dig request. It is resolved on the next tick.
    pub fn dig(&mut self, id: u32, tile: Tile) {
        if self.is_running() && self.is_member(id) {
            self.queue.push((id, tile));
        }
    }

    /// Resolve queued digs (lowest player id first, so simultaneous digs are deterministic) and check the clock.
    pub fn tick(&mut self, now: f64) -> Vec<Out> {
        let Phase::Running { ends_at } = self.phase else {
            return Vec::new();
        };
        let mut outs = Vec::new();
        let mut queue = std::mem::take(&mut self.queue);
        queue.sort_by_key(|(player, _)| *player); // stable: each player's own digs keep their order
        for (player, tile) in queue {
            outs.extend(self.resolve(player, tile, now));
        }
        if now >= ends_at {
            outs.push(self.finish());
        }
        outs
    }

    pub fn return_to_lobby(&mut self, id: u32) -> Vec<Out> {
        if !self.is_member(id) || self.is_running() {
            return Vec::new();
        }
        self.members.retain(|member| !member.left);
        self.game = None;
        self.phase = Phase::Lobby;
        if self.host.is_none_or(|host| !self.is_member(host)) {
            self.host = self.member_ids().first().copied();
        }
        vec![self.lobby_message()]
    }

    fn resolve(&mut self, player: u32, tile: Tile, now: f64) -> Vec<Out> {
        let reach_ok = self
            .members
            .iter()
            .find(|member| member.id == player)
            .and_then(|member| member.position)
            .is_some_and(|(px, pz)| {
                ((px - (f64::from(tile.0) + 0.5)).powi(2)
                    + (pz - (f64::from(tile.1) + 0.5)).powi(2))
                .sqrt()
                    <= DIG_REACH_M
            });
        let Some(state) = self.game.as_mut() else {
            return Vec::new();
        };
        if !reach_ok {
            return vec![refused(player, tile, state.hole(tile).depth, "far")];
        }
        match state.resolve_dig(player, tile, now) {
            DigOutcome::Refused(reason) => {
                vec![refused(player, tile, state.hole(tile).depth, reason.code())]
            }
            DigOutcome::Safe {
                depth,
                points,
                score,
            } => vec![Out {
                to: Target::All,
                message: Json::obj([
                    ("t", Json::str("dg_dig")),
                    ("x", Json::num(tile.0)),
                    ("z", Json::num(tile.1)),
                    ("depth", Json::num(depth)),
                    ("by", Json::num(player)),
                    ("res", Json::str("safe")),
                    ("pts", Json::num(points)),
                    ("score", Json::num(score)),
                ]),
            }],
            DigOutcome::Strike {
                depth,
                kind,
                penalty,
                score,
                strikes,
                reveal,
            } => vec![Out {
                to: Target::All,
                message: Json::obj([
                    ("t", Json::str("dg_dig")),
                    ("x", Json::num(tile.0)),
                    ("z", Json::num(tile.1)),
                    ("depth", Json::num(depth)),
                    ("by", Json::num(player)),
                    ("res", Json::str("strike")),
                    ("kind", Json::str(kind.name())),
                    ("pen", Json::num(penalty)),
                    ("score", Json::num(score)),
                    ("strikes", Json::num(strikes)),
                    (
                        "reveal",
                        Json::Arr(
                            reveal
                                .iter()
                                .map(|&(x, z)| Json::Arr(vec![Json::num(x), Json::num(z)]))
                                .collect(),
                        ),
                    ),
                ]),
            }],
        }
    }

    /// End the match: rank everyone, tell all, and wait for "back to lobby".
    fn finish(&mut self) -> Out {
        self.phase = Phase::Results;
        let Some(state) = self.game.as_ref() else {
            return Out {
                to: Target::All,
                message: Json::obj([
                    ("t", Json::str("dg_end")),
                    ("results", Json::Arr(Vec::new())),
                ]),
            };
        };
        let mut rows: Vec<(u32, &str, i32, u32, i32, bool)> = self
            .members
            .iter()
            .map(|member| {
                let stats = state.stats(member.id).cloned().unwrap_or_default();
                (
                    member.id,
                    member.name.as_str(),
                    stats.score,
                    stats.strikes,
                    stats.deepest,
                    member.left,
                )
            })
            .collect();
        // Best first: highest score, then fewer strikes, then lower id so the order is stable.
        rows.sort_by(|a, b| b.2.cmp(&a.2).then(a.3.cmp(&b.3)).then(a.0.cmp(&b.0)));
        let winner = rows.first().map_or(Json::Null, |row| Json::num(row.0));
        let results = rows
            .iter()
            .map(|&(id, name, score, strikes, deepest, left)| {
                Json::obj([
                    ("id", Json::num(id)),
                    ("name", Json::str(name)),
                    ("score", Json::num(score)),
                    ("strikes", Json::num(strikes)),
                    ("deepest", Json::num(deepest)),
                    ("left", Json::Bool(left)),
                ])
            })
            .collect();
        Out {
            to: Target::All,
            message: Json::obj([
                ("t", Json::str("dg_end")),
                ("winner", winner),
                ("results", Json::Arr(results)),
            ]),
        }
    }

    fn reset(&mut self) {
        self.phase = Phase::Lobby;
        self.members.clear();
        self.host = None;
        self.game = None;
        self.queue.clear();
    }

    fn players_json(&self) -> Json {
        Json::Arr(
            self.members
                .iter()
                .filter(|member| !member.left)
                .map(|member| {
                    Json::obj([
                        ("id", Json::num(member.id)),
                        ("name", Json::str(&member.name)),
                    ])
                })
                .collect(),
        )
    }

    fn lobby_message(&self) -> Out {
        let phase = match self.phase {
            Phase::Lobby => "lobby",
            Phase::Running { .. } => "running",
            Phase::Results => "results",
        };
        Out {
            to: Target::All,
            message: Json::obj([
                ("t", Json::str("dg_lobby")),
                ("players", self.players_json()),
                ("host", self.host.map_or(Json::Null, Json::num)),
                ("phase", Json::str(phase)),
                ("min", Json::num(self.min_players() as f64)),
                ("max", Json::num(self.max_players() as f64)),
            ]),
        }
    }

    /// Positions known for the range check, for tests and diagnostics.
    #[cfg(test)]
    fn positions(&self) -> std::collections::HashMap<u32, Option<(f64, f64)>> {
        self.members
            .iter()
            .map(|member| (member.id, member.position))
            .collect()
    }
}

/// Every DIG SITE game on the server: the shared multiplayer lobby, plus a private
/// one-player game for each player who chose solo play from the SANDBOX menu.
/// Solo games never touch the shared lobby, so someone playing alone does not
/// disturb a lobby that is filling up or a match in progress.
pub struct DigGames {
    shared: DigLobby,
    solo: HashMap<u32, DigLobby>,
    duration: f64,
}

impl DigGames {
    pub fn new(duration: f64) -> Self {
        DigGames {
            shared: DigLobby::with_duration(duration),
            solo: HashMap::new(),
            duration,
        }
    }

    /// The game this player is in: their solo game, or the shared lobby.
    fn lobby_for(&mut self, id: u32) -> &mut DigLobby {
        if self.solo.contains_key(&id) {
            self.solo.get_mut(&id).expect("checked above")
        } else {
            &mut self.shared
        }
    }

    fn resolve(lobby: &DigLobby, outs: Vec<Out>) -> Vec<Delivery> {
        outs.into_iter()
            .flat_map(|out| {
                let recipients = match out.to {
                    Target::One(id) => vec![id],
                    Target::All => lobby.member_ids(),
                };
                recipients.into_iter().map(move |to| Delivery {
                    to,
                    message: out.message.clone(),
                })
            })
            .collect()
    }

    /// True when the player is connected to any DIG SITE game.
    pub fn is_member(&self, id: u32) -> bool {
        self.solo.contains_key(&id) || self.shared.is_member(id)
    }

    pub fn join(&mut self, id: u32, name: &str) -> Vec<Delivery> {
        let outs = self.shared.join(id, name);
        Self::resolve(&self.shared, outs)
    }

    pub fn leave(&mut self, id: u32) -> Vec<Delivery> {
        if self.solo.remove(&id).is_some() {
            return Vec::new();
        }
        let outs = self.shared.leave(id);
        Self::resolve(&self.shared, outs)
    }

    pub fn start(&mut self, id: u32, seed: u64, now: f64) -> Vec<Delivery> {
        let lobby = self.lobby_for(id);
        let outs = lobby.start(id, seed, now);
        Self::resolve(lobby, outs)
    }

    pub fn return_to_lobby(&mut self, id: u32) -> Vec<Delivery> {
        if self.solo.contains_key(&id) {
            return Vec::new(); // a solo player starts a new game instead
        }
        let outs = self.shared.return_to_lobby(id);
        Self::resolve(&self.shared, outs)
    }

    pub fn dig(&mut self, id: u32, tile: Tile) {
        self.lobby_for(id).dig(id, tile);
    }

    pub fn position(&mut self, id: u32, world_x: f64, world_z: f64) {
        self.lobby_for(id).position(id, world_x, world_z);
    }

    /// The other players who should receive this player's pose, tracer and swing messages.
    pub fn relay_targets(&mut self, id: u32) -> Vec<u32> {
        if self.solo.contains_key(&id) || !self.shared.is_running() {
            return Vec::new();
        }
        self.shared
            .member_ids()
            .into_iter()
            .filter(|member| *member != id)
            .collect()
    }

    /// Start (or restart) a private one-player game for `id` and return its map message.
    pub fn start_solo(&mut self, id: u32, name: &str, seed: u64, now: f64) -> Vec<Delivery> {
        let mut deliveries = if self.solo.contains_key(&id) {
            Vec::new()
        } else {
            self.leave(id) // leaving the shared lobby tells the others
        };
        let mut game = DigLobby::solo(self.duration);
        let mut outs = game.join(id, name);
        outs.extend(game.start(id, seed, now));
        // The one-player lobby message is noise: only the map matters to the client.
        outs.retain(|out| out.message.get("t").and_then(Json::as_str) != Some("dg_lobby"));
        deliveries.extend(Self::resolve(&game, outs));
        self.solo.insert(id, game);
        deliveries
    }

    /// Resolve digs and end matches on time, in every game.
    pub fn tick(&mut self, now: f64) -> Vec<Delivery> {
        let outs = self.shared.tick(now);
        let mut deliveries = Self::resolve(&self.shared, outs);
        for game in self.solo.values_mut() {
            let outs = game.tick(now);
            deliveries.extend(Self::resolve(game, outs));
        }
        deliveries
    }
}

fn error(to: u32, code: &str) -> Out {
    Out {
        to: Target::One(to),
        message: Json::obj([("t", Json::str("dg_error")), ("code", Json::str(code))]),
    }
}

/// A dig that did nothing, sent to the digger with the hole's current depth so their view stays right.
fn refused(to: u32, tile: Tile, depth: i32, why: &str) -> Out {
    Out {
        to: Target::One(to),
        message: Json::obj([
            ("t", Json::str("dg_no")),
            ("x", Json::num(tile.0)),
            ("z", Json::num(tile.1)),
            ("depth", Json::num(depth)),
            ("why", Json::str(why)),
        ]),
    }
}

/// What a player may know before digging: buildings, roads and the indicators. Never lines or depths.
fn surface_json(layout: &Layout) -> Json {
    let rect = |r: &layout::Rect| {
        [r.x0, r.z0, r.x1, r.z1]
            .iter()
            .map(|&n| Json::num(n))
            .collect::<Vec<_>>()
    };
    let buildings = layout
        .buildings
        .iter()
        .map(|building| {
            let mut values = rect(&building.rect);
            values.push(Json::num(i32::from(building.faces_larger_z)));
            Json::Arr(values)
        })
        .collect();
    let roads = layout
        .roads
        .iter()
        .map(|road| Json::Arr(rect(road)))
        .collect();
    let indicators = layout
        .indicators
        .iter()
        .map(|indicator| {
            Json::obj([
                ("id", Json::num(indicator.id as f64)),
                ("k", Json::str(indicator.kind.name())),
                ("x", Json::num(indicator.tile.0)),
                ("z", Json::num(indicator.tile.1)),
            ])
        })
        .collect();
    Json::obj([
        ("w", Json::num(layout::WIDTH)),
        ("h", Json::num(layout::HEIGHT)),
        ("buildings", Json::Arr(buildings)),
        ("roads", Json::Arr(roads)),
        ("indicators", Json::Arr(indicators)),
    ])
}

#[cfg(test)]
mod tests {
    use super::super::layout::{Building, Line, Rect, UtilityKind};
    use super::*;

    const TILE: Tile = (10, 10);

    fn lobby_of(count: u32) -> DigLobby {
        let mut lobby = DigLobby::new();
        for id in 1..=count {
            lobby.join(id, &format!("P{id}"));
        }
        lobby
    }

    /// A small layout whose only line is a water main through TILE at `depth`.
    fn test_layout(depth: i32) -> Layout {
        let tiles: Vec<Tile> = (6..=14).map(|x| (x, 10)).collect();
        let depths = vec![depth; tiles.len()];
        Layout {
            seed: 0,
            buildings: vec![Building {
                rect: Rect {
                    x0: 30,
                    z0: 30,
                    x1: 32,
                    z1: 32,
                },
                faces_larger_z: true,
            }],
            roads: Vec::new(),
            indicators: Vec::new(),
            lines: vec![Line {
                kind: UtilityKind::Water,
                tiles,
                depths,
            }],
            spawns: vec![(10, 11), (11, 11), (12, 11)],
        }
    }

    fn start_test_match(lobby: &mut DigLobby, depth: i32) {
        let outs = lobby.start_with(1, 0.0, || test_layout(depth));
        assert!(!outs.is_empty());
        for id in lobby.member_ids() {
            lobby.position(
                id,
                f64::from(TILE.0) + 0.5 - HALF_WIDTH,
                f64::from(TILE.1) + 1.5 - HALF_WIDTH,
            ); // stand next to TILE
        }
    }

    fn texts(outs: &[Out]) -> Vec<String> {
        outs.iter().map(|out| out.message.to_string()).collect()
    }

    fn find<'a>(outs: &'a [Out], kind: &str) -> Vec<&'a Out> {
        outs.iter()
            .filter(|out| out.message.get("t").and_then(Json::as_str) == Some(kind))
            .collect()
    }

    #[test]
    fn should_make_the_first_player_the_host_and_list_everyone() {
        let mut lobby = DigLobby::new();
        lobby.join(7, "Ada");
        let outs = lobby.join(9, "Bob");
        let message = &outs[0].message;
        assert_eq!(message.get("host").and_then(Json::as_i32), Some(7));
        assert_eq!(
            message
                .get("players")
                .and_then(Json::as_arr)
                .map(<[Json]>::len),
            Some(2)
        );
        assert_eq!(message.get("phase").and_then(Json::as_str), Some("lobby"));
        assert_eq!(outs[0].to, Target::All);
    }

    #[test]
    fn should_refuse_a_duplicate_name_without_regard_to_case() {
        let mut lobby = DigLobby::new();
        lobby.join(1, "Ada");
        let outs = lobby.join(2, "ADA");
        assert_eq!(
            outs[0].message.get("code").and_then(Json::as_str),
            Some("name-taken")
        );
        assert!(!lobby.is_member(2));
    }

    #[test]
    fn should_refuse_a_ninth_player_when_the_lobby_is_full() {
        let mut lobby = lobby_of(MAX_PLAYERS as u32);
        let outs = lobby.join(99, "Late");
        assert_eq!(
            outs[0].message.get("code").and_then(Json::as_str),
            Some("full")
        );
    }

    #[test]
    fn should_refuse_to_start_for_a_non_host_or_with_too_few_players() {
        let mut lobby = lobby_of(1);
        let code = |outs: &[Out]| {
            outs[0]
                .message
                .get("code")
                .and_then(Json::as_str)
                .map(str::to_owned)
        };
        assert_eq!(code(&lobby.start(1, 5, 0.0)).as_deref(), Some("too-few"));
        lobby.join(2, "P2");
        assert_eq!(code(&lobby.start(2, 5, 0.0)).as_deref(), Some("not-host"));
        assert!(!lobby.is_running());
    }

    #[test]
    fn should_send_each_player_a_map_with_their_own_spawn_when_the_host_starts() {
        let mut lobby = lobby_of(3);
        let outs = lobby.start(1, 42, 0.0);
        assert!(lobby.is_running());
        let maps = find(&outs, "dg_map");
        assert_eq!(maps.len(), 3);
        let spawns: Vec<String> = maps
            .iter()
            .map(|out| out.message.get("spawn").unwrap().to_string())
            .collect();
        assert_eq!(
            spawns
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            3,
            "spawns differ: {spawns:?}"
        );
        assert_eq!(
            maps[0].message.get("duration").and_then(Json::as_f64),
            Some(MATCH_SECONDS)
        );
    }

    #[test]
    fn should_never_put_line_positions_or_depths_in_the_map_message() {
        let mut lobby = lobby_of(2);
        let outs = lobby.start(1, 42, 0.0);
        for text in texts(&outs) {
            for secret in ["lines", "depth", "tape", "tiles", "reveal", "kind"] {
                assert!(!text.contains(secret), "dg_map leaks {secret:?}: {text}");
            }
        }
        let map = outs[0].message.get("map").unwrap();
        assert!(!map
            .get("indicators")
            .and_then(Json::as_arr)
            .unwrap()
            .is_empty());
        assert!(!map
            .get("buildings")
            .and_then(Json::as_arr)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn should_refuse_joining_while_a_match_is_running() {
        let mut lobby = lobby_of(2);
        lobby.start(1, 1, 0.0);
        let outs = lobby.join(50, "Late");
        assert_eq!(
            outs[0].message.get("code").and_then(Json::as_str),
            Some("in-progress")
        );
        assert!(!lobby.is_member(50));
    }

    #[test]
    fn should_hand_the_host_role_to_the_next_player_when_the_host_leaves_the_lobby() {
        let mut lobby = lobby_of(3);
        let outs = lobby.leave(1);
        assert_eq!(outs[0].message.get("host").and_then(Json::as_i32), Some(2));
        assert_eq!(lobby.member_ids(), vec![2, 3]);
    }

    #[test]
    fn should_keep_the_match_going_and_the_score_when_a_player_disconnects() {
        let mut lobby = lobby_of(3);
        start_test_match(&mut lobby, 60);
        lobby.dig(2, TILE);
        lobby.tick(1.0);
        let outs = lobby.leave(2);
        assert!(lobby.is_running());
        assert!(!lobby.is_member(2));
        let players = outs[0]
            .message
            .get("players")
            .and_then(Json::as_arr)
            .unwrap();
        assert_eq!(players.len(), 2); // roster shows only connected players
        let end = lobby.tick(MATCH_SECONDS + 1.0);
        let results = find(&end, "dg_end")[0]
            .message
            .get("results")
            .and_then(Json::as_arr)
            .unwrap();
        let left = results
            .iter()
            .find(|row| row.get("id").and_then(Json::as_i32) == Some(2))
            .unwrap();
        assert_eq!(left.get("left"), Some(&Json::Bool(true)));
        assert_eq!(left.get("score").and_then(Json::as_i32), Some(10));
    }

    #[test]
    fn should_reset_when_everyone_has_left() {
        let mut lobby = lobby_of(2);
        start_test_match(&mut lobby, 60);
        lobby.leave(1);
        lobby.leave(2);
        assert!(!lobby.is_running());
        assert!(lobby.member_ids().is_empty());
        assert!(!lobby.join(3, "New").is_empty());
    }

    #[test]
    fn should_resolve_simultaneous_digs_on_one_tile_in_player_id_order() {
        let mut lobby = lobby_of(2);
        start_test_match(&mut lobby, 6); // a strike on the first layer
        lobby.dig(2, TILE); // player 2's request arrives first...
        lobby.dig(1, TILE);
        let outs = lobby.tick(10.0);
        let digs = find(&outs, "dg_dig");
        assert_eq!(digs.len(), 1);
        assert_eq!(digs[0].message.get("by").and_then(Json::as_i32), Some(1)); // ...but player 1 resolves first
        assert_eq!(
            digs[0].message.get("res").and_then(Json::as_str),
            Some("strike")
        );
        let no = find(&outs, "dg_no");
        assert_eq!(no.len(), 1);
        assert_eq!(no[0].to, Target::One(2));
        assert_eq!(
            no[0].message.get("why").and_then(Json::as_str),
            Some("locked")
        );
    }

    #[test]
    fn should_let_the_later_digger_build_on_the_depth_when_the_first_dig_was_safe() {
        let mut lobby = lobby_of(2);
        start_test_match(&mut lobby, 60);
        lobby.dig(2, TILE);
        lobby.dig(1, TILE);
        let outs = lobby.tick(10.0);
        let digs = find(&outs, "dg_dig");
        let depths: Vec<(i32, i32)> = digs
            .iter()
            .map(|out| {
                (
                    out.message.get("by").and_then(Json::as_i32).unwrap(),
                    out.message.get("depth").and_then(Json::as_i32).unwrap(),
                )
            })
            .collect();
        assert_eq!(depths, vec![(1, 6), (2, 12)]);
    }

    #[test]
    fn should_reveal_the_line_only_in_the_strike_message() {
        let mut lobby = lobby_of(2);
        start_test_match(&mut lobby, 12);
        lobby.dig(1, TILE);
        let first = lobby.tick(10.0);
        assert!(
            !texts(&first)
                .iter()
                .any(|t| t.contains("reveal") || t.contains("kind")),
            "a safe dig reveals nothing"
        );
        lobby.dig(1, TILE);
        let second = lobby.tick(20.0);
        let strike = &find(&second, "dg_dig")[0].message;
        assert_eq!(strike.get("res").and_then(Json::as_str), Some("strike"));
        assert_eq!(strike.get("kind").and_then(Json::as_str), Some("water"));
        assert!(strike.get("reveal").and_then(Json::as_arr).unwrap().len() >= 4);
    }

    #[test]
    fn should_refuse_a_dig_that_is_out_of_reach() {
        let mut lobby = lobby_of(2);
        start_test_match(&mut lobby, 60);
        lobby.position(1, -20.0, -20.0); // far corner
        lobby.dig(1, TILE);
        let outs = lobby.tick(10.0);
        assert!(find(&outs, "dg_dig").is_empty());
        assert_eq!(
            find(&outs, "dg_no")[0]
                .message
                .get("why")
                .and_then(Json::as_str),
            Some("far")
        );
    }

    #[test]
    fn should_refuse_a_dig_when_the_player_position_is_unknown() {
        let mut lobby = lobby_of(2);
        lobby.start_with(1, 0.0, || test_layout(60));
        lobby.dig(1, TILE);
        assert!(lobby.positions()[&1].is_none());
        assert_eq!(
            find(&lobby.tick(10.0), "dg_no")[0]
                .message
                .get("why")
                .and_then(Json::as_str),
            Some("far")
        );
    }

    #[test]
    fn should_ignore_digs_from_players_outside_the_match() {
        let mut lobby = lobby_of(2);
        start_test_match(&mut lobby, 60);
        lobby.dig(77, TILE);
        assert!(find(&lobby.tick(10.0), "dg_dig").is_empty());
    }

    #[test]
    fn should_end_the_match_on_time_and_rank_by_score_then_fewer_strikes() {
        let mut lobby = lobby_of(3);
        start_test_match(&mut lobby, 60);
        for tick in 0..3 {
            lobby.dig(2, (TILE.0, TILE.1 + tick)); // player 2 digs three different tiles... only those in reach count
        }
        lobby.dig(1, TILE);
        lobby.tick(5.0);
        let outs = lobby.tick(MATCH_SECONDS + 0.5);
        let end = &find(&outs, "dg_end")[0].message;
        let results = end.get("results").and_then(Json::as_arr).unwrap();
        let scores: Vec<i32> = results
            .iter()
            .map(|row| row.get("score").and_then(Json::as_i32).unwrap())
            .collect();
        assert!(
            scores.windows(2).all(|pair| pair[0] >= pair[1]),
            "sorted best first: {scores:?}"
        );
        assert_eq!(
            end.get("winner").and_then(Json::as_i32),
            results[0].get("id").and_then(Json::as_i32)
        );
        assert!(!lobby.is_running());
    }

    #[test]
    fn should_break_a_score_tie_in_favour_of_fewer_strikes() {
        let mut lobby = lobby_of(2);
        start_test_match(&mut lobby, 18);
        // Player 1: two safe layers (25). Player 2: a safe layer, then a strike elsewhere that costs nothing it earned.
        lobby.dig(1, TILE);
        lobby.tick(10.0);
        lobby.dig(1, TILE);
        lobby.tick(20.0);
        lobby.dig(2, (TILE.0 + 1, TILE.1));
        lobby.tick(30.0);
        lobby.dig(2, (TILE.0 + 1, TILE.1));
        lobby.tick(40.0);
        lobby.dig(2, (TILE.0 + 1, TILE.1)); // layer 3 hits 18: strike
        lobby.tick(50.0);
        let end = find(&lobby.tick(MATCH_SECONDS + 1.0), "dg_end")[0]
            .message
            .clone();
        let results = end.get("results").and_then(Json::as_arr).unwrap();
        let first = results[0].get("id").and_then(Json::as_i32).unwrap();
        assert_eq!(first, 1, "player 1 leads on score: {end}");
    }

    #[test]
    fn should_return_to_the_lobby_after_the_results_and_drop_those_who_left() {
        let mut lobby = lobby_of(3);
        start_test_match(&mut lobby, 60);
        lobby.leave(3);
        lobby.tick(MATCH_SECONDS + 1.0);
        assert!(!lobby.is_running());
        let outs = lobby.return_to_lobby(2);
        let message = &outs[0].message;
        assert_eq!(message.get("phase").and_then(Json::as_str), Some("lobby"));
        assert_eq!(
            message
                .get("players")
                .and_then(Json::as_arr)
                .map(<[Json]>::len),
            Some(2)
        );
        let again = lobby.start_with(1, 0.0, || test_layout(60));
        assert_eq!(
            find(&again, "dg_map").len(),
            2,
            "a new match can start from the lobby"
        );
    }

    #[test]
    fn should_start_a_solo_game_with_one_player_and_flag_the_map_as_solo() {
        let mut solo = DigLobby::solo(MATCH_SECONDS);
        solo.join(1, "Ada");
        let outs = solo.start(1, 42, 0.0);
        let maps = find(&outs, "dg_map");
        assert_eq!(maps.len(), 1);
        assert_eq!(maps[0].message.get("solo"), Some(&Json::Bool(true)));
        assert!(solo.is_running());
    }

    #[test]
    fn should_mark_shared_matches_as_not_solo() {
        let mut lobby = lobby_of(2);
        let outs = lobby.start(1, 42, 0.0);
        assert_eq!(
            find(&outs, "dg_map")[0].message.get("solo"),
            Some(&Json::Bool(false))
        );
    }

    #[test]
    fn should_refuse_a_second_player_in_a_solo_game() {
        let mut solo = DigLobby::solo(MATCH_SECONDS);
        solo.join(1, "Ada");
        let outs = solo.join(2, "Bob");
        assert_eq!(
            outs[0].message.get("code").and_then(Json::as_str),
            Some("full")
        );
    }

    #[test]
    fn should_run_a_solo_match_from_dig_to_results() {
        let mut solo = DigLobby::solo(60.0);
        solo.join(1, "Ada");
        solo.start_with(1, 0.0, || test_layout(60));
        solo.position(
            1,
            f64::from(TILE.0) + 0.5 - HALF_WIDTH,
            f64::from(TILE.1) + 1.5 - HALF_WIDTH,
        );
        solo.dig(1, TILE);
        let digs = solo.tick(5.0);
        assert_eq!(
            find(&digs, "dg_dig")[0]
                .message
                .get("score")
                .and_then(Json::as_i32),
            Some(10)
        );
        let end = find(&solo.tick(61.0), "dg_end")[0].message.clone();
        assert_eq!(end.get("winner").and_then(Json::as_i32), Some(1));
    }

    #[test]
    fn should_not_return_to_the_lobby_while_a_match_is_running() {
        let mut lobby = lobby_of(2);
        start_test_match(&mut lobby, 60);
        assert!(lobby.return_to_lobby(1).is_empty());
        assert!(lobby.is_running());
    }

    fn game_texts(deliveries: &[Delivery]) -> Vec<(u32, String)> {
        deliveries
            .iter()
            .map(|d| {
                (
                    d.to,
                    d.message
                        .get("t")
                        .and_then(Json::as_str)
                        .unwrap_or("")
                        .to_owned(),
                )
            })
            .collect()
    }

    #[test]
    fn should_start_a_private_solo_game_without_touching_the_shared_lobby() {
        let mut games = DigGames::new(MATCH_SECONDS);
        games.join(1, "Ada");
        games.join(2, "Bob");
        let deliveries = games.start_solo(9, "Solo", 7, 0.0);
        assert_eq!(game_texts(&deliveries), vec![(9, "dg_map".to_owned())]);
        assert!(games.is_member(9));
        // The shared lobby still has its two players and has not started.
        assert!(!games.shared.is_running());
        assert_eq!(games.shared.member_ids(), vec![1, 2]);
        assert_eq!(
            game_texts(&games.start(1, 1, 0.0))
                .iter()
                .filter(|(_, t)| t == "dg_map")
                .count(),
            2
        );
    }

    #[test]
    fn should_take_a_player_out_of_the_shared_lobby_when_they_go_solo() {
        let mut games = DigGames::new(MATCH_SECONDS);
        games.join(1, "Ada");
        games.join(2, "Bob");
        let deliveries = games.start_solo(2, "Bob", 7, 0.0);
        assert!(
            game_texts(&deliveries).contains(&(1, "dg_lobby".to_owned())),
            "Ada is told Bob left"
        );
        assert_eq!(games.shared.member_ids(), vec![1]);
    }

    #[test]
    fn should_replace_the_solo_game_when_a_player_starts_another() {
        let mut games = DigGames::new(MATCH_SECONDS);
        games.start_solo(3, "Solo", 1, 0.0);
        games.position(3, 0.0, 0.0);
        let again = games.start_solo(3, "Solo", 2, 100.0);
        assert_eq!(game_texts(&again), vec![(3, "dg_map".to_owned())]);
        assert!(games.solo[&3].is_running());
    }

    #[test]
    fn should_remove_the_solo_game_when_the_player_leaves() {
        let mut games = DigGames::new(MATCH_SECONDS);
        games.start_solo(3, "Solo", 1, 0.0);
        assert!(games.leave(3).is_empty());
        assert!(!games.is_member(3));
    }

    #[test]
    fn should_tick_solo_games_and_send_results_only_to_their_player() {
        let mut games = DigGames::new(10.0);
        games.join(1, "Ada");
        games.start_solo(3, "Solo", 1, 0.0);
        let early = games.tick(5.0);
        assert!(early.is_empty());
        let end = games.tick(11.0);
        assert_eq!(game_texts(&end), vec![(3, "dg_end".to_owned())]);
    }

    #[test]
    fn should_not_relay_poses_for_solo_players_or_before_a_shared_match_runs() {
        let mut games = DigGames::new(MATCH_SECONDS);
        games.join(1, "Ada");
        games.join(2, "Bob");
        assert!(
            games.relay_targets(1).is_empty(),
            "no relay while the lobby is waiting"
        );
        games.start(1, 3, 0.0);
        assert_eq!(games.relay_targets(1), vec![2]);
        games.start_solo(5, "Solo", 1, 0.0);
        assert!(games.relay_targets(5).is_empty());
    }

    #[test]
    fn should_ignore_back_to_lobby_for_a_solo_player() {
        let mut games = DigGames::new(MATCH_SECONDS);
        games.start_solo(3, "Solo", 1, 0.0);
        assert!(games.return_to_lobby(3).is_empty());
        assert!(games.is_member(3));
    }
}
