//! The CABLE BOTS server: serves the game's files and runs DIG SITE on the reusable core
//! (core/server). The port is taken from the PORT env var (default 8123); if it is busy,
//! the next ports are tried.

mod dig;
mod dig_server;

use std::env;
use std::path::{Path, PathBuf};

use dig_server::DigServer;
use server_core::{run, ServerConfig};

/// Folders that are never served: the server's own source, tests, build output and installed packages.
const BLOCKED_PATHS: &[&str] = &[
    "core/server/",
    "game/server/",
    "tests/",
    "node_modules/",
    "target/",
];

fn main() {
    let mut config = ServerConfig::new(game_root());
    config.blocked_prefixes = BLOCKED_PATHS
        .iter()
        .map(|folder| (*folder).to_owned())
        .collect();
    config
        .json_routes
        .push((DEV_FLAG_PATH.to_owned(), dev_flag_json()));
    run(DigServer::new(dig_server::match_seconds()), config);
}

/// The page asks for this to learn whether the server was started in developer mode.
const DEV_FLAG_PATH: &str = "/dev-flag.json";

/// `{"dev":true}` when the CABLE_DEV env var is "1", otherwise `{"dev":false}`.
fn dev_flag_json() -> String {
    let enabled = env::var("CABLE_DEV").is_ok_and(|value| value == "1");
    format!("{{\"dev\":{enabled}}}")
}

/// The game folder: GAME_DIR if set, otherwise the repository root (two levels above this crate).
fn game_root() -> PathBuf {
    env::var("GAME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}
