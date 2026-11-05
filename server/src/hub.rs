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

use std::collections::HashMap;
use std::io;
use std::net::TcpStream;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::websocket::{accept_key, encode_frame, read_frame, OP_CLOSE, OP_PING, OP_PONG, OP_TEXT};

pub const MAX_PLAYERS: usize = 8;
pub const MAX_NAME_LEN: usize = 16;

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

pub struct Hub {
    clients: Mutex<HashMap<u32, Client>>,
    next_id: AtomicU32,
}

impl Hub {
    pub fn new() -> Self {
        Hub {
            clients: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }

    fn connect(&self, outbox: SyncSender<Vec<u8>>) -> u32 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut clients = self.clients.lock().unwrap();
        clients.insert(id, Client { name: None, outbox });
        send_to(&clients, id, &format!("{{\"t\":\"welcome\",\"id\":{id}}}"));
        send_to(&clients, id, &roster_json(&clients));
        id
    }

    fn disconnect(&self, id: u32) {
        let mut clients = self.clients.lock().unwrap();
        let was_joined = clients
            .remove(&id)
            .is_some_and(|client| client.name.is_some());
        if was_joined {
            broadcast_all(&clients, &roster_json(&clients));
        }
    }

    fn handle_text(&self, id: u32, text: &str) {
        let mut clients = self.clients.lock().unwrap();
        match json_string_field(text, "t").as_deref() {
            Some("join") => join(&mut clients, id, json_string_field(text, "name")),
            Some("ping") => {
                let number = json_number_field(text, "n").unwrap_or_default();
                send_to(&clients, id, &format!("{{\"t\":\"pong\",\"n\":{number}}}"));
            }
            _ => relay(&clients, id, text),
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
pub fn serve(hub: &Arc<Hub>, mut stream: TcpStream, client_key: &str) -> io::Result<()> {
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

fn read_loop(
    hub: &Hub,
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

    fn connect(hub: &Hub) -> (u32, Receiver<Vec<u8>>) {
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
        let hub = Hub::new();
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
        let hub = Hub::new();
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
        let hub = Hub::new();
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
        let hub = Hub::new();
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
        let hub = Hub::new();
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
        let hub = Hub::new();
        let (a, _a_inbox) = connect(&hub);
        let (b, b_inbox) = connect(&hub);
        hub.handle_text(b, "{\"t\":\"join\",\"name\":\"B\"}");
        drain(&b_inbox);
        hub.handle_text(a, "{\"t\":\"state\"}");
        assert!(next_text(&b_inbox).is_none());
    }

    #[test]
    fn should_update_the_roster_when_a_joined_player_leaves() {
        let hub = Hub::new();
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
        let hub = Hub::new();
        let (id, inbox) = connect(&hub);
        drain(&inbox);
        hub.handle_text(id, "{\"t\":\"ping\",\"n\":12345}");
        assert_eq!(next_text(&inbox).unwrap(), "{\"t\":\"pong\",\"n\":12345}");
    }
}
