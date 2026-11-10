//! Dig rules: depth layers, scoring, cooldown and dig resolution.
//!
//! Everything is pure: `DigState::resolve_dig` takes the player, the tile and the
//! current time, and returns what happened. The caller decides the order of digs
//! (the lobby sorts each tick by player id), so two players on one tile always get
//! the same result.
//!
//! Depth is measured in inches to the top of a pipe. One dig removes one 6 inch
//! layer. A dig strikes a line when the new hole depth reaches or passes that
//! line's depth at the tile. Digging above it is always safe.

use std::collections::{HashMap, HashSet};

use super::layout::{Layout, Tile, UtilityKind, HEIGHT, WIDTH};

pub const LAYER_IN: i32 = 6;
pub const MAX_DEPTH_IN: i32 = 132;
/// Seconds before the first dig in a hole can follow a previous dig.
pub const BASE_COOLDOWN: f64 = 0.6;
/// Extra seconds of cooldown for every layer already dug in the hole.
pub const COOLDOWN_PER_LAYER: f64 = 0.12;
/// How many tiles along a struck line (each way) are revealed to everyone.
pub const REVEAL_REACH: usize = 3;
/// Overshoot (inches past the line) below this is a clip, which costs less.
pub const CLIP_OVERSHOOT_IN: i32 = 2;
pub const CLIP_FACTOR: f64 = 0.6;
const TIMING_SLACK: f64 = 1e-6;

/// Points for digging layer `layer` (1 is the first). Deeper layers are worth more.
pub fn layer_points(layer: i32) -> i32 {
    10 + 5 * (layer - 1)
}

/// Points lost for striking a line, `overshoot` inches past its depth.
pub fn strike_penalty(kind: UtilityKind, overshoot: i32) -> i32 {
    let base = match kind {
        UtilityKind::Gas => 400,
        UtilityKind::Electric => 300,
        UtilityKind::Water => 150,
        UtilityKind::Telecom => 100,
        UtilityKind::Sewer => 75,
    };
    let factor = if overshoot < CLIP_OVERSHOOT_IN {
        CLIP_FACTOR
    } else {
        1.0
    };
    (f64::from(base) * factor).round() as i32
}

/// Seconds a player must wait after a dig, given how many layers the hole already has.
pub fn dig_cooldown(layers_in_hole: i32) -> f64 {
    BASE_COOLDOWN + COOLDOWN_PER_LAYER * f64::from(layers_in_hole)
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Hole {
    pub depth: i32,
    pub locked: bool,
}

#[derive(Debug, Clone, Default)]
pub struct Stats {
    pub score: i32,
    pub strikes: u32,
    pub deepest: i32,
    last_dig: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    UnknownPlayer,
    OutOfBounds,
    Building,
    /// A struck hole, or a tile on a line that has been revealed.
    Locked,
    MaxDepth,
    Cooldown,
}

impl Refusal {
    pub fn code(self) -> &'static str {
        match self {
            Refusal::UnknownPlayer => "unknown-player",
            Refusal::OutOfBounds => "out-of-bounds",
            Refusal::Building => "building",
            Refusal::Locked => "locked",
            Refusal::MaxDepth => "max-depth",
            Refusal::Cooldown => "cooldown",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum DigOutcome {
    Refused(Refusal),
    /// A layer came out clean. Nothing warns a digger that a line is near: only a strike tells them.
    Safe {
        depth: i32,
        points: i32,
        score: i32,
    },
    Strike {
        depth: i32,
        kind: UtilityKind,
        penalty: i32,
        score: i32,
        strikes: u32,
        reveal: Vec<Tile>,
    },
}

#[derive(Debug, Clone)]
struct Buried {
    line: usize,
    depth: i32,
}

pub struct DigState {
    layout: Layout,
    buried: HashMap<Tile, Vec<Buried>>,
    holes: HashMap<Tile, Hole>,
    revealed: HashSet<Tile>,
    stats: HashMap<u32, Stats>,
}

impl DigState {
    pub fn new(layout: Layout) -> Self {
        let mut buried: HashMap<Tile, Vec<Buried>> = HashMap::new();
        for (index, line) in layout.lines.iter().enumerate() {
            for (at, &tile) in line.tiles.iter().enumerate() {
                buried.entry(tile).or_default().push(Buried {
                    line: index,
                    depth: line.depths[at],
                });
            }
        }
        for entries in buried.values_mut() {
            entries.sort_by_key(|entry| entry.depth); // shallowest first: the one a dig meets first
        }
        DigState {
            layout,
            buried,
            holes: HashMap::new(),
            revealed: HashSet::new(),
            stats: HashMap::new(),
        }
    }

    pub fn layout(&self) -> &Layout {
        &self.layout
    }

    pub fn add_player(&mut self, id: u32) {
        self.stats.entry(id).or_default();
    }

    pub fn stats(&self, id: u32) -> Option<&Stats> {
        self.stats.get(&id)
    }

    pub fn hole(&self, tile: Tile) -> Hole {
        self.holes.get(&tile).copied().unwrap_or_default()
    }

    #[cfg(test)]
    pub fn is_revealed(&self, tile: Tile) -> bool {
        self.revealed.contains(&tile)
    }

    /// Resolve one dig by `player` on `tile` at time `now` (seconds).
    pub fn resolve_dig(&mut self, player: u32, tile: Tile, now: f64) -> DigOutcome {
        let (x, z) = tile;
        if !(0..WIDTH).contains(&x) || !(0..HEIGHT).contains(&z) {
            return DigOutcome::Refused(Refusal::OutOfBounds);
        }
        if self
            .layout
            .buildings
            .iter()
            .any(|building| building.rect.contains(tile))
        {
            return DigOutcome::Refused(Refusal::Building);
        }
        if !self.stats.contains_key(&player) {
            return DigOutcome::Refused(Refusal::UnknownPlayer);
        }
        let hole = self.hole(tile);
        if hole.locked || self.revealed.contains(&tile) {
            return DigOutcome::Refused(Refusal::Locked);
        }
        let new_depth = hole.depth + LAYER_IN;
        if new_depth > MAX_DEPTH_IN {
            return DigOutcome::Refused(Refusal::MaxDepth);
        }
        let layers_before = hole.depth / LAYER_IN;
        let stats = self.stats.get_mut(&player).expect("checked above");
        if let Some(last) = stats.last_dig {
            if now - last < dig_cooldown(layers_before) - TIMING_SLACK {
                return DigOutcome::Refused(Refusal::Cooldown);
            }
        }
        stats.last_dig = Some(now);

        let buried = self
            .buried
            .get(&tile)
            .map(Vec::as_slice)
            .unwrap_or_default();
        if let Some(hit) = buried.iter().find(|entry| new_depth >= entry.depth) {
            let (line_index, line_depth) = (hit.line, hit.depth);
            return self.strike(player, tile, new_depth, line_index, new_depth - line_depth);
        }

        let points = layer_points(layers_before + 1);
        let stats = self.stats.get_mut(&player).expect("checked above");
        stats.score += points;
        stats.deepest = stats.deepest.max(new_depth);
        let score = stats.score;
        self.holes.insert(
            tile,
            Hole {
                depth: new_depth,
                locked: false,
            },
        );
        DigOutcome::Safe {
            depth: new_depth,
            points,
            score,
        }
    }

    fn strike(
        &mut self,
        player: u32,
        tile: Tile,
        depth: i32,
        line_index: usize,
        overshoot: i32,
    ) -> DigOutcome {
        let line = &self.layout.lines[line_index];
        let kind = line.kind;
        let at = line.tiles.iter().position(|&t| t == tile).unwrap_or(0);
        let first = at.saturating_sub(REVEAL_REACH);
        let last = (at + REVEAL_REACH).min(line.tiles.len() - 1);
        let reveal: Vec<Tile> = line.tiles[first..=last].to_vec();

        let penalty = strike_penalty(kind, overshoot);
        let stats = self.stats.get_mut(&player).expect("checked by the caller");
        stats.score = (stats.score - penalty).max(0);
        stats.strikes += 1;
        let (score, strikes) = (stats.score, stats.strikes);

        self.holes.insert(
            tile,
            Hole {
                depth,
                locked: true,
            },
        );
        self.revealed.extend(reveal.iter().copied());
        DigOutcome::Strike {
            depth,
            kind,
            penalty,
            score,
            strikes,
            reveal,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::layout::{Building, Line, Rect};
    use super::*;

    const TILE: Tile = (5, 5);

    /// A tiny site with one line crossing TILE at `depth` (and the tiles either side of it).
    fn state_with_line(kind: UtilityKind, depth: i32) -> DigState {
        let tiles: Vec<Tile> = (0..11).map(|i| (i, 5)).collect();
        let depths = vec![depth; tiles.len()];
        DigState::new(Layout {
            seed: 0,
            buildings: vec![Building {
                rect: Rect {
                    x0: 20,
                    z0: 20,
                    x1: 22,
                    z1: 22,
                },
                faces_larger_z: true,
            }],
            roads: Vec::new(),
            indicators: Vec::new(),
            lines: vec![Line {
                kind,
                tiles,
                depths,
            }],
            spawns: Vec::new(),
        })
    }

    fn dig(state: &mut DigState, player: u32, tile: Tile, clock: &mut f64) -> DigOutcome {
        *clock += 10.0; // far past any cooldown
        state.resolve_dig(player, tile, *clock)
    }

    #[test]
    fn should_dig_safely_when_the_hole_is_still_above_the_line() {
        let mut state = state_with_line(UtilityKind::Water, 40);
        state.add_player(1);
        let mut clock = 0.0;
        for expected in [6, 12, 18, 24, 30, 36] {
            match dig(&mut state, 1, TILE, &mut clock) {
                DigOutcome::Safe { depth, .. } => assert_eq!(depth, expected),
                other => panic!("expected a safe dig at {expected} in, got {other:?}"),
            }
        }
        assert_eq!(state.stats(1).unwrap().strikes, 0);
        assert_eq!(state.hole(TILE).depth, 36);
    }

    #[test]
    fn should_strike_when_the_new_depth_equals_the_line_depth() {
        let mut state = state_with_line(UtilityKind::Gas, 24);
        state.add_player(1);
        let mut clock = 0.0;
        for _ in 0..3 {
            assert!(matches!(
                dig(&mut state, 1, TILE, &mut clock),
                DigOutcome::Safe { .. }
            ));
        }
        match dig(&mut state, 1, TILE, &mut clock) {
            DigOutcome::Strike {
                depth,
                kind,
                penalty,
                ..
            } => {
                assert_eq!((depth, kind), (24, UtilityKind::Gas));
                assert_eq!(penalty, strike_penalty(UtilityKind::Gas, 0)); // exactly at the pipe: a clip
            }
            other => panic!("expected a strike, got {other:?}"),
        }
    }

    #[test]
    fn should_strike_when_a_layer_passes_through_the_line_depth() {
        let mut state = state_with_line(UtilityKind::Electric, 20);
        state.add_player(1);
        let mut clock = 0.0;
        for _ in 0..3 {
            assert!(matches!(
                dig(&mut state, 1, TILE, &mut clock),
                DigOutcome::Safe { .. }
            )); // 6, 12, 18
        }
        match dig(&mut state, 1, TILE, &mut clock) {
            DigOutcome::Strike { depth, penalty, .. } => {
                assert_eq!(depth, 24); // went 4 in past the pipe
                assert_eq!(penalty, strike_penalty(UtilityKind::Electric, 4));
                assert_eq!(penalty, 300);
            }
            other => panic!("expected a strike, got {other:?}"),
        }
    }

    #[test]
    fn should_charge_less_for_a_clip_than_for_a_solid_hit() {
        assert_eq!(strike_penalty(UtilityKind::Gas, 0), 240);
        assert_eq!(strike_penalty(UtilityKind::Gas, 1), 240);
        assert_eq!(strike_penalty(UtilityKind::Gas, 2), 400);
        assert_eq!(strike_penalty(UtilityKind::Gas, 5), 400);
        assert_eq!(strike_penalty(UtilityKind::Sewer, 3), 75);
        assert!(strike_penalty(UtilityKind::Gas, 3) > strike_penalty(UtilityKind::Water, 3));
        assert!(strike_penalty(UtilityKind::Electric, 3) > strike_penalty(UtilityKind::Sewer, 3));
    }

    #[test]
    fn should_give_no_warning_before_a_strike() {
        // Digging toward a line gives nothing but plain safe layers, right up to the strike.
        let mut state = state_with_line(UtilityKind::Water, 38);
        state.add_player(1);
        let mut clock = 0.0;
        let results: Vec<DigOutcome> = (0..7)
            .map(|_| dig(&mut state, 1, TILE, &mut clock))
            .collect();
        for (index, result) in results.iter().take(6).enumerate() {
            let depth = 6 * (index as i32 + 1);
            assert!(
                matches!(result, DigOutcome::Safe { depth: d, .. } if *d == depth),
                "dig {index}: {result:?}"
            );
        }
        assert!(matches!(results[6], DigOutcome::Strike { depth: 42, .. }));
    }

    #[test]
    fn should_pay_the_same_points_whatever_is_buried_below() {
        let points = |depth| {
            let mut state = state_with_line(UtilityKind::Telecom, depth);
            state.add_player(1);
            let mut clock = 0.0;
            dig(&mut state, 1, TILE, &mut clock); // layer 1, whatever lies beneath
            match dig(&mut state, 1, TILE, &mut clock) {
                DigOutcome::Safe { points, .. } => points,
                other => panic!("{other:?}"),
            }
        };
        assert_eq!(points(14), points(120));
        assert_eq!(points(14), 15);
    }

    #[test]
    fn should_let_the_second_digger_continue_from_the_first_ones_depth() {
        let mut state = state_with_line(UtilityKind::Sewer, 120);
        state.add_player(1);
        state.add_player(2);
        let mut clock = 0.0;
        assert!(matches!(
            dig(&mut state, 1, TILE, &mut clock),
            DigOutcome::Safe { depth: 6, .. }
        ));
        match dig(&mut state, 2, TILE, &mut clock) {
            DigOutcome::Safe { depth, points, .. } => assert_eq!((depth, points), (12, 15)), // layer 2 pays 15, to player 2
            other => panic!("{other:?}"),
        }
        assert_eq!(state.stats(1).unwrap().score, 10);
        assert_eq!(state.stats(2).unwrap().score, 15);
    }

    #[test]
    fn should_refuse_the_second_digger_when_the_first_struck_the_tile() {
        let mut state = state_with_line(UtilityKind::Water, 6);
        state.add_player(1);
        state.add_player(2);
        // Same instant, player 1 resolved first (the lobby orders each tick by player id).
        assert!(matches!(
            state.resolve_dig(1, TILE, 50.0),
            DigOutcome::Strike { .. }
        ));
        assert_eq!(
            state.resolve_dig(2, TILE, 50.0),
            DigOutcome::Refused(Refusal::Locked)
        );
        assert_eq!(state.stats(2).unwrap().score, 0);
        assert_eq!(state.stats(2).unwrap().strikes, 0);
    }

    #[test]
    fn should_follow_the_scoring_curve() {
        assert_eq!(
            (1..=5).map(layer_points).collect::<Vec<_>>(),
            [10, 15, 20, 25, 30]
        );
        let total: i32 = (1..=22).map(layer_points).sum();
        assert_eq!(total, 22 * 10 + 5 * (21 * 22 / 2));
        assert!(layer_points(22) > layer_points(1));
    }

    #[test]
    fn should_add_up_points_per_layer_for_the_digger() {
        let mut state = state_with_line(UtilityKind::Sewer, 120);
        state.add_player(1);
        let mut clock = 0.0;
        for _ in 0..4 {
            dig(&mut state, 1, TILE, &mut clock);
        }
        assert_eq!(state.stats(1).unwrap().score, 10 + 15 + 20 + 25);
        assert_eq!(state.stats(1).unwrap().deepest, 24);
    }

    #[test]
    fn should_subtract_the_penalty_and_never_go_below_zero() {
        let mut state = state_with_line(UtilityKind::Gas, 6);
        state.add_player(1);
        // A strike on layer 1 with 0 points: the score floors at 0.
        match state.resolve_dig(1, TILE, 10.0) {
            DigOutcome::Strike { score, strikes, .. } => assert_eq!((score, strikes), (0, 1)),
            other => panic!("{other:?}"),
        }
        // Earn some points elsewhere, then strike again: points drop by the penalty.
        let mut clock = 10.0;
        for tile in [(0, 4), (1, 4), (2, 4)] {
            for _ in 0..3 {
                dig(&mut state, 1, tile, &mut clock);
            }
        }
        let before = state.stats(1).unwrap().score;
        assert!(before > 0);
        match dig(&mut state, 1, (9, 5), &mut clock) {
            DigOutcome::Strike { score, penalty, .. } => {
                assert_eq!(score, (before - penalty).max(0))
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn should_lock_the_struck_hole_and_reveal_the_line_around_it() {
        let mut state = state_with_line(UtilityKind::Water, 6);
        state.add_player(1);
        let outcome = state.resolve_dig(1, TILE, 10.0);
        let DigOutcome::Strike { reveal, kind, .. } = outcome else {
            panic!("{outcome:?}")
        };
        assert_eq!(kind, UtilityKind::Water);
        assert_eq!(
            reveal,
            vec![(2, 5), (3, 5), (4, 5), (5, 5), (6, 5), (7, 5), (8, 5)]
        ); // 3 tiles each way
        assert!(state.hole(TILE).locked);
        assert!(state.is_revealed((7, 5)));
        assert!(!state.is_revealed((9, 5)));
        let mut clock = 10.0;
        assert_eq!(
            dig(&mut state, 1, TILE, &mut clock),
            DigOutcome::Refused(Refusal::Locked)
        );
        assert_eq!(
            dig(&mut state, 1, (6, 5), &mut clock),
            DigOutcome::Refused(Refusal::Locked)
        ); // revealed tile
        assert!(matches!(
            dig(&mut state, 1, (9, 5), &mut clock),
            DigOutcome::Strike { .. }
        )); // beyond the reveal, same line
    }

    #[test]
    fn should_make_a_player_wait_between_digs_and_longer_in_deeper_holes() {
        assert!((dig_cooldown(0) - 0.6).abs() < 1e-9);
        assert!((dig_cooldown(5) - 1.2).abs() < 1e-9);
        let mut state = state_with_line(UtilityKind::Sewer, 120);
        state.add_player(1);
        assert!(matches!(
            state.resolve_dig(1, TILE, 100.0),
            DigOutcome::Safe { .. }
        ));
        assert_eq!(
            state.resolve_dig(1, TILE, 100.3),
            DigOutcome::Refused(Refusal::Cooldown)
        );
        // The second layer follows a hole with 1 layer: 0.72 s.
        assert_eq!(
            state.resolve_dig(1, TILE, 100.7),
            DigOutcome::Refused(Refusal::Cooldown)
        );
        assert!(matches!(
            state.resolve_dig(1, TILE, 100.73),
            DigOutcome::Safe { depth: 12, .. }
        ));
    }

    #[test]
    fn should_not_start_the_cooldown_when_a_dig_is_refused() {
        let mut state = state_with_line(UtilityKind::Sewer, 120);
        state.add_player(1);
        assert_eq!(
            state.resolve_dig(1, (21, 21), 100.0),
            DigOutcome::Refused(Refusal::Building)
        );
        assert!(matches!(
            state.resolve_dig(1, TILE, 100.0),
            DigOutcome::Safe { .. }
        ));
    }

    #[test]
    fn should_stop_at_the_maximum_depth() {
        let mut state = state_with_line(UtilityKind::Sewer, 133);
        state.add_player(1);
        let mut clock = 0.0;
        for _ in 0..22 {
            assert!(matches!(
                dig(&mut state, 1, TILE, &mut clock),
                DigOutcome::Safe { .. }
            ));
        }
        assert_eq!(state.hole(TILE).depth, MAX_DEPTH_IN);
        assert_eq!(
            dig(&mut state, 1, TILE, &mut clock),
            DigOutcome::Refused(Refusal::MaxDepth)
        );
    }

    #[test]
    fn should_refuse_bad_tiles_and_unknown_players() {
        let mut state = state_with_line(UtilityKind::Sewer, 120);
        state.add_player(1);
        assert_eq!(
            state.resolve_dig(1, (-1, 5), 1.0),
            DigOutcome::Refused(Refusal::OutOfBounds)
        );
        assert_eq!(
            state.resolve_dig(1, (5, 48), 1.0),
            DigOutcome::Refused(Refusal::OutOfBounds)
        );
        assert_eq!(
            state.resolve_dig(9, TILE, 1.0),
            DigOutcome::Refused(Refusal::UnknownPlayer)
        );
    }

    #[test]
    fn should_meet_the_shallowest_line_first_when_two_share_a_tile() {
        let tiles = vec![TILE];
        let layout = Layout {
            seed: 0,
            buildings: Vec::new(),
            roads: Vec::new(),
            indicators: Vec::new(),
            lines: vec![
                Line {
                    kind: UtilityKind::Sewer,
                    tiles: tiles.clone(),
                    depths: vec![60],
                },
                Line {
                    kind: UtilityKind::Telecom,
                    tiles,
                    depths: vec![18],
                },
            ],
            spawns: Vec::new(),
        };
        let mut state = DigState::new(layout);
        state.add_player(1);
        let mut clock = 0.0;
        for _ in 0..2 {
            dig(&mut state, 1, TILE, &mut clock);
        }
        match dig(&mut state, 1, TILE, &mut clock) {
            DigOutcome::Strike { kind, .. } => assert_eq!(kind, UtilityKind::Telecom),
            other => panic!("{other:?}"),
        }
    }
}
