//! The smallest game on the server core: it serves a folder and answers `ec_ping` with `ec_pong`.
//!
//!   cargo run -p server-core --example echo -- path/to/game/folder
//!
//! Everything else (usernames, the roster, relaying players' messages, pings, the WebSocket at /ws)
//! comes from the core. See core/README.md.

use std::path::PathBuf;

use server_core::json::Json;
use server_core::{run, Delivery, GameServer, ServerConfig};

struct EchoGame;

impl GameServer for EchoGame {
    fn prefix(&self) -> &'static str {
        "ec_"
    }

    fn on_message(&mut self, from: u32, message: &Json, _now: f64) -> Vec<Delivery> {
        match message.get("t").and_then(Json::as_str) {
            Some("ec_ping") => vec![Delivery {
                to: from,
                message: Json::obj([("t", Json::str("ec_pong"))]),
            }],
            _ => Vec::new(),
        }
    }

    fn on_peer_message(&mut self, _from: u32, _kind: &str, _text: &str) -> Option<Vec<u32>> {
        None // let the hub relay everything else to the other players
    }

    fn on_leave(&mut self, _id: u32) -> Vec<Delivery> {
        Vec::new()
    }

    fn on_tick(&mut self, _now: f64) -> Vec<Delivery> {
        Vec::new()
    }
}

fn main() {
    let folder = std::env::args()
        .nth(1)
        .map_or_else(|| PathBuf::from("."), PathBuf::from);
    run(EchoGame, ServerConfig::new(folder));
}
