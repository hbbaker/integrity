//! The multiplayer hub: a plain message relay. It knows who is connected, checks
//! usernames, and forwards every game message from a joined player to all the
//! other joined players. It does not simulate or validate gameplay.
//!
//! Server -> client messages:
//!   {"t":"welcome","id":N}                         right after connecting
//!   {"t":"roster","players":[{"id":N,"name":".."}]} whenever someone joins or leaves
//!   {"t":"error","code":"name-taken|bad-name|full"} a rejected join
//!   {"t":"pong","n":N}                              reply to a client ping
//!   {"from":N,"m":{..}}                             a relayed game message
//! Client -> server messages: {"t":"join","name":".."}, {"t":"ping","n":N}, anything else is relayed.
//!
//! A game adds its own server-side logic by implementing `GameServer`: messages whose type starts
//! with the game's prefix (for example `dg_`) go to the game, the game answers with `Delivery`s,
//! and the game can claim other messages (a player's position, say) to relay only to its own group.
//! The hub itself knows nothing about any game.

use std::collections::HashMap;
use std::io;
use std::net::TcpStream;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::json::Json;
use crate::websocket::{accept_key, encode_frame, read_frame, OP_CLOSE, OP_PING, OP_PONG, OP_TEXT};

pub const MAX_PLAYERS: usize = 8;
pub const MAX_NAME_LEN: usize = 16;

/// A message for one connected client, produced by a game.
#[derive(Debug, Clone)]
pub struct Delivery {
    pub to: u32,
    pub message: Json,
}

/// What a game plugs into the hub. All methods run with the hub's game lock held, one at a time.
pub trait GameServer: Send + 'static {
    /// Message types that start with this belong to the game (for example `"dg_"`).
    fn prefix(&self) -> &'static str;

    /// A parsed message of the game's own type. `now` is seconds since the hub started.
    fn on_message(&mut self, from: u32, message: &Json, now: f64) -> Vec<Delivery>;

    /// A message of another type from a connected client (a player's state, for example). Return `None`
    /// to let the hub relay it to every joined player as usual, or `Some(targets)` to claim it and
    /// pass it to just those clients (an empty list drops it).
    fn on_peer_message(&mut self, from: u32, kind: &str, text: &str) -> Option<Vec<u32>>;

    /// A client disconnected.
    fn on_leave(&mut self, id: u32) -> Vec<Delivery>;

    /// About every tick interval: resolve queued work, end timed matches.
    fn on_tick(&mut self, now: f64) -> Vec<Delivery>;
}

/// Messages queued per client. A client that falls this far behind loses messages
/// (state updates are replaced by newer ones anyway).
const OUTBOX_SIZE: usize = 256;
/// Clients ping every few seconds, so this much silence means the connection is dead.
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const WRITE_TIMEOUT: Duration = Duration::from_secs(3);

struct Client {
    name: Option<String>,
    outbox: SyncSender<Vec<u8>>,
}

pub struct Hub<G: GameServer> {
    // Lock order: `clients` first, then `game`.
    clients: Mutex<HashMap<u32, Client>>,
    game: Mutex<G>,
    prefix: &'static str,
    next_id: AtomicU32,
    started: Instant,
}

impl<G: GameServer> Hub<G> {
    pub fn new(game: G) -> Self {
        let prefix = game.prefix();
        Hub {
            clients: Mutex::new(HashMap::new()),
            game: Mutex::new(game),
            prefix,
            next_id: AtomicU32::new(1),
            started: Instant::now(),
        }
    }

    pub fn connect(&self, outbox: SyncSender<Vec<u8>>) -> u32 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut clients = self.clients.lock().unwrap();
        clients.insert(id, Client { name: None, outbox });
        send_to(&clients, id, &format!("{{\"t\":\"welcome\",\"id\":{id}}}"));
        send_to(&clients, id, &roster_json(&clients));
        id
    }

    pub fn disconnect(&self, id: u32) {
        let mut clients = self.clients.lock().unwrap();
        let was_joined = clients
            .remove(&id)
            .is_some_and(|client| client.name.is_some());
        if was_joined {
            broadcast_all(&clients, &roster_json(&clients));
        }
        let deliveries = self.game.lock().unwrap().on_leave(id);
        deliver(&clients, deliveries);
    }

    /// Seconds since the hub started: the clock the game uses for cooldowns and timers.
    fn now(&self) -> f64 {
        self.started.elapsed().as_secs_f64()
    }

    /// Called on every tick interval: lets the game resolve queued work and end timed matches.
    pub fn tick(&self) {
        let clients = self.clients.lock().unwrap();
        let deliveries = self.game.lock().unwrap().on_tick(self.now());
        deliver(&clients, deliveries);
    }

    pub fn handle_text(&self, id: u32, text: &str) {
        let mut clients = self.clients.lock().unwrap();
        let kind = json_string_field(text, "t");
        if kind
            .as_deref()
            .is_some_and(|name| name.starts_with(self.prefix))
        {
            self.handle_game(&clients, id, text);
            return;
        }
        if let Some(kind) = kind.as_deref() {
            if self.relay_to_game_group(&clients, id, kind, text) {
                return;
            }
        }
        match kind.as_deref() {
            Some("join") => join(&mut clients, id, json_string_field(text, "name")),
            Some("ping") => {
                let number = json_number_field(text, "n").unwrap_or_default();
                send_to(&clients, id, &format!("{{\"t\":\"pong\",\"n\":{number}}}"));
            }
            _ => relay(&clients, id, text),
        }
    }
}

impl<G: GameServer> Hub<G> {
    /// A message of the game's own type.
    fn handle_game(&self, clients: &HashMap<u32, Client>, id: u32, text: &str) {
        let Some(message) = Json::parse(text) else {
            return;
        };
        let deliveries = self
            .game
            .lock()
            .unwrap()
            .on_message(id, &message, self.now());
        deliver(clients, deliveries);
    }

    /// Let the game claim a message (such as a player's pose) and relay it to its own group only.
    /// Returns true when the game claimed it.
    fn relay_to_game_group(
        &self,
        clients: &HashMap<u32, Client>,
        from: u32,
        kind: &str,
        text: &str,
    ) -> bool {
        let Some(targets) = self.game.lock().unwrap().on_peer_message(from, kind, text) else {
            return false;
        };
        let trimmed = text.trim();
        if trimmed.starts_with('{') && trimmed.ends_with('}') {
            let frame = encode_frame(
                OP_TEXT,
                format!("{{\"from\":{from},\"m\":{trimmed}}}").as_bytes(),
            );
            for member in targets {
                if let Some(client) = clients.get(&member) {
                    let _ = client.outbox.try_send(frame.clone());
                }
            }
        }
        true
    }
}

/// Send the messages a game call produced.
fn deliver(clients: &HashMap<u32, Client>, deliveries: Vec<Delivery>) {
    for delivery in deliveries {
        if let Some(client) = clients.get(&delivery.to) {
            let frame = encode_frame(OP_TEXT, delivery.message.to_string().as_bytes());
            let _ = client.outbox.try_send(frame);
        }
    }
}

/// Register a username for a connection, or tell it why not.
fn join(clients: &mut HashMap<u32, Client>, id: u32, name: Option<String>) {
    if clients.get(&id).is_none_or(|client| client.name.is_some()) {
        return; // unknown, or already joined
    }
    let name = name.unwrap_or_default().trim().to_owned();
    if !is_valid_name(&name) {
        send_to(clients, id, "{\"t\":\"error\",\"code\":\"bad-name\"}");
        return;
    }
    let joined = clients
        .values()
        .filter(|client| client.name.is_some())
        .count();
    if joined >= MAX_PLAYERS {
        send_to(clients, id, "{\"t\":\"error\",\"code\":\"full\"}");
        return;
    }
    let taken = clients
        .values()
        .filter_map(|client| client.name.as_deref())
        .any(|other| other.eq_ignore_ascii_case(&name));
    if taken {
        send_to(clients, id, "{\"t\":\"error\",\"code\":\"name-taken\"}");
        return;
    }
    if let Some(client) = clients.get_mut(&id) {
        client.name = Some(name);
    }
    broadcast_all(clients, &roster_json(clients));
}

/// Forward a joined player's message to every other joined player, tagged with the sender.
fn relay(clients: &HashMap<u32, Client>, from: u32, text: &str) {
    let joined = clients
        .get(&from)
        .is_some_and(|client| client.name.is_some());
    let trimmed = text.trim();
    if !joined || !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return;
    }
    let wrapped = encode_frame(
        OP_TEXT,
        format!("{{\"from\":{from},\"m\":{trimmed}}}").as_bytes(),
    );
    for (id, client) in clients {
        if *id != from && client.name.is_some() {
            let _ = client.outbox.try_send(wrapped.clone());
        }
    }
}

fn send_to(clients: &HashMap<u32, Client>, id: u32, text: &str) {
    if let Some(client) = clients.get(&id) {
        let _ = client
            .outbox
            .try_send(encode_frame(OP_TEXT, text.as_bytes()));
    }
}

fn broadcast_all(clients: &HashMap<u32, Client>, text: &str) {
    let frame = encode_frame(OP_TEXT, text.as_bytes());
    for client in clients.values() {
        let _ = client.outbox.try_send(frame.clone());
    }
}

/// Names are embedded in JSON without escaping, so the character set must stay narrow.
pub fn is_valid_name(name: &str) -> bool {
    let length = name.chars().count();
    (1..=MAX_NAME_LEN).contains(&length)
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '_' || c == '-')
}

fn roster_json(clients: &HashMap<u32, Client>) -> String {
    let mut players: Vec<(u32, &str)> = clients
        .iter()
        .filter_map(|(id, client)| client.name.as_deref().map(|name| (*id, name)))
        .collect();
    players.sort_unstable_by_key(|(id, _)| *id);
    let items: Vec<String> = players
        .iter()
        .map(|(id, name)| format!("{{\"id\":{id},\"name\":\"{name}\"}}"))
        .collect();
    format!("{{\"t\":\"roster\",\"players\":[{}]}}", items.join(","))
}

/// The string value of a top-level-looking `"key":"value"` pair. Values with escapes are refused.
fn json_string_field(text: &str, key: &str) -> Option<String> {
    let rest = value_after_key(text, key)?.strip_prefix('"')?;
    let end = rest.find('"')?;
    let value = &rest[..end];
    (!value.contains('\\')).then(|| value.to_owned())
}

/// The numeric value of a `"key":123` pair, as text (digits, sign and dot only).
fn json_number_field(text: &str, key: &str) -> Option<String> {
    let rest = value_after_key(text, key)?;
    let number: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || matches!(c, '-' | '.'))
        .collect();
    (!number.is_empty()).then_some(number)
}

fn value_after_key<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    let marker = format!("\"{key}\"");
    let after = &text[text.find(&marker)? + marker.len()..];
    Some(after.trim_start().strip_prefix(':')?.trim_start())
}

/// Upgrade an HTTP connection to a WebSocket and run it until it closes.
pub fn serve<G: GameServer>(
    hub: &Arc<Hub<G>>,
    mut stream: TcpStream,
    client_key: &str,
) -> io::Result<()> {
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
        accept_key(client_key)
    );
    io::Write::write_all(&mut stream, response.as_bytes())?;
    stream.set_nodelay(true)?; // small, frequent messages: do not wait to batch them
    stream.set_read_timeout(Some(IDLE_TIMEOUT))?;

    let writer_stream = stream.try_clone()?;
    writer_stream.set_write_timeout(Some(WRITE_TIMEOUT))?;
    let (outbox, inbox) = sync_channel(OUTBOX_SIZE);
    thread::spawn(move || write_loop(writer_stream, inbox));

    let id = hub.connect(outbox.clone());
    let result = read_loop(hub, id, &mut stream, &outbox);
    hub.disconnect(id);
    result
}

fn write_loop(mut stream: TcpStream, inbox: Receiver<Vec<u8>>) {
    for frame in inbox {
        if io::Write::write_all(&mut stream, &frame).is_err() {
            break;
        }
    }
    let _ = stream.shutdown(std::net::Shutdown::Both); // unblocks the read loop if the writer gave up
}

fn read_loop<G: GameServer>(
    hub: &Hub<G>,
    id: u32,
    stream: &mut TcpStream,
    outbox: &SyncSender<Vec<u8>>,
) -> io::Result<()> {
    loop {
        let frame = read_frame(stream)?;
        match frame.opcode {
            OP_TEXT => {
                if let Ok(text) = std::str::from_utf8(&frame.payload) {
                    hub.handle_text(id, text);
                }
            }
            OP_PING => {
                let _ = outbox.try_send(encode_frame(OP_PONG, &frame.payload));
            }
            OP_CLOSE => return Ok(()),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::Receiver;

    /// A game with no logic of its own: the hub then only relays.
    struct NoGame;

    impl GameServer for NoGame {
        fn prefix(&self) -> &'static str {
            "zz_"
        }
        fn on_message(&mut self, _from: u32, _message: &Json, _now: f64) -> Vec<Delivery> {
            Vec::new()
        }
        fn on_peer_message(&mut self, _from: u32, _kind: &str, _text: &str) -> Option<Vec<u32>> {
            None
        }
        fn on_leave(&mut self, _id: u32) -> Vec<Delivery> {
            Vec::new()
        }
        fn on_tick(&mut self, _now: f64) -> Vec<Delivery> {
            Vec::new()
        }
    }

    fn connect<G: GameServer>(hub: &Hub<G>) -> (u32, Receiver<Vec<u8>>) {
        let (outbox, inbox) = sync_channel(OUTBOX_SIZE);
        (hub.connect(outbox), inbox)
    }

    /// Decode the text of the next queued server frame (server frames are unmasked, short).
    fn next_text(inbox: &Receiver<Vec<u8>>) -> Option<String> {
        let frame = inbox.try_recv().ok()?;
        let (start, length) = match frame[1] {
            126 => (4, u16::from_be_bytes([frame[2], frame[3]]) as usize),
            short => (2, short as usize),
        };
        Some(String::from_utf8(frame[start..start + length].to_vec()).unwrap())
    }

    fn drain(inbox: &Receiver<Vec<u8>>) {
        while next_text(inbox).is_some() {}
    }

    #[test]
    fn should_send_welcome_and_roster_when_a_client_connects() {
        let hub = Hub::new(NoGame);
        let (id, inbox) = connect(&hub);
        assert_eq!(
            next_text(&inbox).unwrap(),
            format!("{{\"t\":\"welcome\",\"id\":{id}}}")
        );
        assert_eq!(
            next_text(&inbox).unwrap(),
            "{\"t\":\"roster\",\"players\":[]}"
        );
    }

    #[test]
    fn should_list_the_player_in_the_roster_when_a_valid_name_joins() {
        let hub = Hub::new(NoGame);
        let (id, inbox) = connect(&hub);
        drain(&inbox);
        hub.handle_text(id, "{\"t\":\"join\",\"name\":\"Ada\"}");
        assert_eq!(
            next_text(&inbox).unwrap(),
            format!("{{\"t\":\"roster\",\"players\":[{{\"id\":{id},\"name\":\"Ada\"}}]}}")
        );
    }

    #[test]
    fn should_reject_a_duplicate_name_when_compared_without_case() {
        let hub = Hub::new(NoGame);
        let (first, _first_inbox) = connect(&hub);
        let (second, second_inbox) = connect(&hub);
        hub.handle_text(first, "{\"t\":\"join\",\"name\":\"Ada\"}");
        drain(&second_inbox);
        hub.handle_text(second, "{\"t\":\"join\",\"name\":\"ADA\"}");
        assert_eq!(
            next_text(&second_inbox).unwrap(),
            "{\"t\":\"error\",\"code\":\"name-taken\"}"
        );
    }

    #[test]
    fn should_reject_names_with_characters_that_need_json_escaping() {
        assert!(is_valid_name("Player_1-b"));
        assert!(!is_valid_name("a\"b"));
        assert!(!is_valid_name("a\\b"));
        assert!(!is_valid_name(""));
        assert!(!is_valid_name("12345678901234567"));
    }

    #[test]
    fn should_reject_a_join_when_the_lobby_is_full() {
        let hub = Hub::new(NoGame);
        let mut keep = Vec::new();
        for n in 0..MAX_PLAYERS {
            let (id, inbox) = connect(&hub);
            hub.handle_text(id, &format!("{{\"t\":\"join\",\"name\":\"P{n}\"}}"));
            keep.push(inbox);
        }
        let (late, late_inbox) = connect(&hub);
        drain(&late_inbox);
        hub.handle_text(late, "{\"t\":\"join\",\"name\":\"Late\"}");
        assert_eq!(
            next_text(&late_inbox).unwrap(),
            "{\"t\":\"error\",\"code\":\"full\"}"
        );
    }

    #[test]
    fn should_relay_to_other_joined_players_only_when_a_joined_player_sends() {
        let hub = Hub::new(NoGame);
        let (a, a_inbox) = connect(&hub);
        let (b, b_inbox) = connect(&hub);
        let (_lurker, lurker_inbox) = connect(&hub);
        hub.handle_text(a, "{\"t\":\"join\",\"name\":\"A\"}");
        hub.handle_text(b, "{\"t\":\"join\",\"name\":\"B\"}");
        drain(&a_inbox);
        drain(&b_inbox);
        drain(&lurker_inbox);
        hub.handle_text(a, "{\"t\":\"state\",\"x\":1}");
        assert_eq!(
            next_text(&b_inbox).unwrap(),
            format!("{{\"from\":{a},\"m\":{{\"t\":\"state\",\"x\":1}}}}")
        );
        assert!(next_text(&a_inbox).is_none());
        assert!(next_text(&lurker_inbox).is_none());
    }

    #[test]
    fn should_ignore_messages_from_a_client_that_has_not_joined() {
        let hub = Hub::new(NoGame);
        let (a, _a_inbox) = connect(&hub);
        let (b, b_inbox) = connect(&hub);
        hub.handle_text(b, "{\"t\":\"join\",\"name\":\"B\"}");
        drain(&b_inbox);
        hub.handle_text(a, "{\"t\":\"state\"}");
        assert!(next_text(&b_inbox).is_none());
    }

    #[test]
    fn should_update_the_roster_when_a_joined_player_leaves() {
        let hub = Hub::new(NoGame);
        let (a, _a_inbox) = connect(&hub);
        let (b, b_inbox) = connect(&hub);
        hub.handle_text(a, "{\"t\":\"join\",\"name\":\"A\"}");
        hub.handle_text(b, "{\"t\":\"join\",\"name\":\"B\"}");
        drain(&b_inbox);
        hub.disconnect(a);
        assert_eq!(
            next_text(&b_inbox).unwrap(),
            format!("{{\"t\":\"roster\",\"players\":[{{\"id\":{b},\"name\":\"B\"}}]}}")
        );
    }

    #[test]
    fn should_echo_the_ping_number_when_a_client_pings() {
        let hub = Hub::new(NoGame);
        let (id, inbox) = connect(&hub);
        drain(&inbox);
        hub.handle_text(id, "{\"t\":\"ping\",\"n\":12345}");
        assert_eq!(next_text(&inbox).unwrap(), "{\"t\":\"pong\",\"n\":12345}");
    }

    /// A toy game: echoes `zz_say` to everyone, claims `pose` messages for a fixed group, and counts leaves and ticks.
    struct ToyGame {
        group: Vec<u32>,
        leaves: Vec<u32>,
        ticks: u32,
    }

    impl GameServer for ToyGame {
        fn prefix(&self) -> &'static str {
            "zz_"
        }
        fn on_message(&mut self, from: u32, message: &Json, _now: f64) -> Vec<Delivery> {
            let text = message
                .get("text")
                .and_then(Json::as_str)
                .unwrap_or_default();
            self.group
                .iter()
                .map(|to| Delivery {
                    to: *to,
                    message: Json::obj([
                        ("t", Json::str("zz_heard")),
                        ("from", Json::num(from)),
                        ("text", Json::str(text)),
                    ]),
                })
                .collect()
        }
        fn on_peer_message(&mut self, from: u32, kind: &str, _text: &str) -> Option<Vec<u32>> {
            (kind == "pose").then(|| {
                self.group
                    .iter()
                    .copied()
                    .filter(|id| *id != from)
                    .collect()
            })
        }
        fn on_leave(&mut self, id: u32) -> Vec<Delivery> {
            self.leaves.push(id);
            Vec::new()
        }
        fn on_tick(&mut self, _now: f64) -> Vec<Delivery> {
            self.ticks += 1;
            self.group
                .iter()
                .map(|to| Delivery {
                    to: *to,
                    message: Json::obj([("t", Json::str("zz_tick"))]),
                })
                .collect()
        }
    }

    /// A connected client in a test: its id and the frames queued for it.
    type TestClient = (u32, Receiver<Vec<u8>>);

    fn toy_hub() -> (Hub<ToyGame>, TestClient, TestClient, TestClient) {
        let hub = Hub::new(ToyGame {
            group: Vec::new(),
            leaves: Vec::new(),
            ticks: 0,
        });
        let a = connect(&hub);
        let b = connect(&hub);
        let outsider = connect(&hub);
        hub.game.lock().unwrap().group = vec![a.0, b.0];
        drain(&a.1);
        drain(&b.1);
        drain(&outsider.1);
        (hub, a, b, outsider)
    }

    #[test]
    fn should_send_the_games_deliveries_when_a_game_message_arrives() {
        let (hub, (a, a_inbox), (_b, b_inbox), (_o, outsider_inbox)) = toy_hub();
        hub.handle_text(a, "{\"t\":\"zz_say\",\"text\":\"hi\"}");
        let expected = format!("{{\"t\":\"zz_heard\",\"from\":{a},\"text\":\"hi\"}}");
        assert_eq!(next_text(&a_inbox).unwrap(), expected);
        assert_eq!(next_text(&b_inbox).unwrap(), expected);
        assert!(next_text(&outsider_inbox).is_none());
    }

    #[test]
    fn should_ignore_a_game_message_that_is_not_valid_json() {
        let (hub, (a, a_inbox), (_b, b_inbox), _outsider) = toy_hub();
        hub.handle_text(a, "{\"t\":\"zz_say\", oops");
        assert!(next_text(&a_inbox).is_none() && next_text(&b_inbox).is_none());
    }

    #[test]
    fn should_relay_a_claimed_message_to_the_games_group_only_when_the_game_claims_it() {
        let (hub, (a, a_inbox), (b, b_inbox), (_o, outsider_inbox)) = toy_hub();
        hub.handle_text(a, "{\"t\":\"pose\",\"x\":1}");
        assert_eq!(
            next_text(&b_inbox).unwrap(),
            format!("{{\"from\":{a},\"m\":{{\"t\":\"pose\",\"x\":1}}}}")
        );
        assert!(
            next_text(&a_inbox).is_none(),
            "the sender does not hear itself"
        );
        assert!(
            next_text(&outsider_inbox).is_none(),
            "players outside the group do not hear it"
        );
        assert_ne!(a, b);
    }

    #[test]
    fn should_tell_the_game_when_a_client_leaves_and_on_every_tick() {
        let (hub, (a, _a_inbox), (_b, b_inbox), _outsider) = toy_hub();
        hub.tick();
        assert_eq!(next_text(&b_inbox).unwrap(), "{\"t\":\"zz_tick\"}");
        hub.disconnect(a);
        let game = hub.game.lock().unwrap();
        assert_eq!(game.leaves, vec![a]);
        assert_eq!(game.ticks, 1);
    }
}
