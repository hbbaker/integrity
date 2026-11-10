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
    run(DigServer::new(dig_server::match_seconds()), config);
}

/// The game folder: GAME_DIR if set, otherwise the repository root (two levels above this crate).
fn game_root() -> PathBuf {
    env::var("GAME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}
