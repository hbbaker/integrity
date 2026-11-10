//! DIG SITE as a `GameServer`: the glue between the core's hub and the game's lobby and rules.
//!
//! Messages starting with `dg_` are lobby actions and dig requests. Pose, tracer and swing messages
//! (`s`, `sh`, `ml`) from a player in a DIG SITE game are claimed here: the server notes where the
//! player stands (for the dig reach check) and the hub passes the message to the other players of a
//! shared match.

use std::time::{SystemTime, UNIX_EPOCH};

use server_core::hub::is_valid_name;
use server_core::json::Json;
use server_core::{Delivery, GameServer};

use crate::dig::lobby::{DigGames, MATCH_SECONDS};

/// The name a solo player gets when they send none (or an invalid one).
const SOLO_NAME: &str = "Solo";
const MESSAGE_PREFIX: &str = "dg_";
const POSE_KINDS: [&str; 3] = ["s", "sh", "ml"];

pub struct DigServer {
    games: DigGames,
}

impl DigServer {
    pub fn new(match_seconds: f64) -> Self {
        DigServer {
            games: DigGames::new(match_seconds),
        }
    }
}

/// Match length: DIG_MATCH_SECONDS if set (for testing), otherwise the normal length.
pub fn match_seconds() -> f64 {
    std::env::var("DIG_MATCH_SECONDS")
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|seconds| *seconds > 0.0)
        .unwrap_or(MATCH_SECONDS)
}

/// A map seed that differs every match. It is not secret from the server; clients never see it.
fn fresh_seed(id: u32) -> u64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos() as u64);
    nanos ^ (u64::from(id) << 32)
}

impl GameServer for DigServer {
    fn prefix(&self) -> &'static str {
        MESSAGE_PREFIX
    }

    /// A `dg_*` message: lobby actions and dig requests.
    fn on_message(&mut self, id: u32, message: &Json, now: f64) -> Vec<Delivery> {
        let name = message
            .get("name")
            .and_then(Json::as_str)
            .unwrap_or_default()
            .trim();
        let dig = &mut self.games;
        match message.get("t").and_then(Json::as_str) {
            Some("dg_join") if is_valid_name(name) => dig.join(id, name),
            Some("dg_join") => vec![Delivery {
                to: id,
                message: Json::obj([
                    ("t", Json::str("dg_error")),
                    ("code", Json::str("bad-name")),
                ]),
            }],
            // Solo play: a private one-player game that starts at once. A bad or missing name falls back to "Solo".
            Some("dg_solo") => {
                let solo_name = if is_valid_name(name) { name } else { SOLO_NAME };
                dig.start_solo(id, solo_name, fresh_seed(id), now)
            }
            Some("dg_leave") => dig.leave(id),
            Some("dg_start") => dig.start(id, fresh_seed(id), now),
            Some("dg_again") => dig.return_to_lobby(id),
            Some("dg_dig") => {
                let coordinate = |key| message.get(key).and_then(Json::as_i32);
                if let (Some(x), Some(z)) = (coordinate("x"), coordinate("z")) {
                    dig.dig(id, (x, z));
                }
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    fn on_peer_message(&mut self, from: u32, kind: &str, text: &str) -> Option<Vec<u32>> {
        if !POSE_KINDS.contains(&kind) || !self.games.is_member(from) {
            return None;
        }
        if kind == "s" {
            if let Some(message) = Json::parse(text) {
                let coordinate = |key| message.get(key).and_then(Json::as_f64);
                if let (Some(x), Some(z)) = (coordinate("x"), coordinate("z")) {
                    self.games.position(from, x, z);
                }
            }
        }
        Some(self.games.relay_targets(from))
    }

    fn on_leave(&mut self, id: u32) -> Vec<Delivery> {
        self.games.leave(id)
    }

    fn on_tick(&mut self, now: f64) -> Vec<Delivery> {
        self.games.tick(now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server() -> DigServer {
        DigServer::new(60.0)
    }

    fn message(text: &str) -> Json {
        Json::parse(text).unwrap()
    }

    fn types(deliveries: &[Delivery]) -> Vec<String> {
        deliveries
            .iter()
            .map(|d| {
                d.message
                    .get("t")
                    .and_then(Json::as_str)
                    .unwrap_or("?")
                    .to_owned()
            })
            .collect()
    }

    #[test]
    fn should_start_a_private_match_when_a_player_asks_for_solo_play() {
        let mut game = server();
        let out = game.on_message(1, &message(r#"{"t":"dg_solo","name":"Ada"}"#), 0.0);
        assert!(types(&out).contains(&"dg_map".to_owned()));
        assert!(
            out.iter().all(|d| d.to == 1),
            "nobody else hears a solo game"
        );
    }

    #[test]
    fn should_fall_back_to_the_solo_name_when_the_name_is_bad() {
        let mut game = server();
        let out = game.on_message(1, &message(r#"{"t":"dg_solo","name":"a\"b"}"#), 0.0);
        let map = out
            .iter()
            .find(|d| d.message.get("t").and_then(Json::as_str) == Some("dg_map"))
            .unwrap();
        assert!(map.message.to_string().contains("\"Solo\""));
    }

    #[test]
    fn should_refuse_a_lobby_join_when_the_name_is_bad() {
        let mut game = server();
        let out = game.on_message(1, &message(r#"{"t":"dg_join","name":"bad\"name"}"#), 0.0);
        assert_eq!(types(&out), vec!["dg_error"]);
    }

    #[test]
    fn should_join_the_lobby_and_leave_it_when_asked() {
        let mut game = server();
        let joined = game.on_message(1, &message(r#"{"t":"dg_join","name":"Ada"}"#), 0.0);
        assert_eq!(types(&joined), vec!["dg_lobby"]);
        assert!(game.games.is_member(1));
        game.on_message(1, &message(r#"{"t":"dg_leave"}"#), 1.0);
        assert!(!game.games.is_member(1));
    }

    #[test]
    fn should_claim_pose_messages_only_from_members_of_a_match() {
        let mut game = server();
        assert_eq!(
            game.on_peer_message(1, "s", r#"{"t":"s","x":1,"z":2}"#),
            None,
            "a stranger's pose is left to the hub"
        );
        game.on_message(1, &message(r#"{"t":"dg_solo","name":"Ada"}"#), 0.0);
        assert_eq!(
            game.on_peer_message(1, "s", r#"{"t":"s","x":1,"z":2}"#),
            Some(Vec::new()),
            "a solo player has nobody to relay to"
        );
        assert_eq!(
            game.on_peer_message(1, "state", "{}"),
            None,
            "other message types are not claimed"
        );
    }

    #[test]
    fn should_ignore_a_dig_request_with_fractional_coordinates() {
        let mut game = server();
        game.on_message(1, &message(r#"{"t":"dg_solo","name":"Ada"}"#), 0.0);
        let out = game.on_message(1, &message(r#"{"t":"dg_dig","x":1.5,"z":2}"#), 0.5);
        assert!(out.is_empty());
    }

    #[test]
    fn should_end_a_match_when_its_time_runs_out() {
        let mut game = DigServer::new(5.0);
        game.on_message(1, &message(r#"{"t":"dg_solo","name":"Ada"}"#), 0.0);
        assert!(game.on_tick(1.0).is_empty());
        let end = game.on_tick(6.0);
        assert!(types(&end).contains(&"dg_end".to_owned()));
    }
}
