//! Reusable game server core. Standard library only.
//!
//! What a browser game needs from its server, with no game inside:
//!   http       serves the game's files over HTTP (an allow-list of file types, no path tricks)
//!   websocket  the WebSocket handshake and frame codec
//!   hub        the connection hub: usernames, a roster, pings, relaying players' messages,
//!              and a `GameServer` trait a game implements to add its own server-side logic
//!   json       a small JSON parser and writer
//!   rng        a seeded random generator, for maps that must be reproducible
//!
//! A game's `main` builds its `GameServer` and calls `run`.

pub mod http;
pub mod hub;
pub mod json;
pub mod rng;
pub mod websocket;

use std::net::{IpAddr, TcpListener, UdpSocket};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

pub use hub::{Delivery, GameServer, Hub};

const PORT_ATTEMPTS: u16 = 20;

/// How the server runs. Everything has a sensible default except the folder to serve.
pub struct ServerConfig {
    /// The folder that holds the game's files (index.html and the folders next to it).
    pub root: PathBuf,
    /// The first port to try; the next ones are tried if it is busy. PORT in the environment overrides it.
    pub default_port: u16,
    /// How often the game's `on_tick` runs.
    pub tick_interval: Duration,
    /// Paths (relative to `root`) that start with any of these are never served: folders such as the
    /// server's own source (end them in "/"), or files such as "package.json".
    pub blocked_prefixes: Vec<String>,
    /// Exact request paths (such as "/dev-flag.json") answered with a fixed JSON body. Lets the game
    /// hand the page values the server read from its environment.
    pub json_routes: Vec<(String, String)>,
}

impl ServerConfig {
    pub fn new(root: PathBuf) -> Self {
        ServerConfig {
            root,
            default_port: 8123,
            tick_interval: Duration::from_millis(50),
            blocked_prefixes: Vec::new(),
            json_routes: Vec::new(),
        }
    }
}

/// Serve the game's files and its WebSocket hub until the process ends.
pub fn run<G: GameServer>(game: G, config: ServerConfig) {
    let root = config.root.canonicalize().unwrap_or_else(|error| {
        eprintln!("Cannot open game folder {}: {error}", config.root.display());
        std::process::exit(1);
    });
    let start_port = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(config.default_port);

    let (listener, port) = bind_first_free(start_port).unwrap_or_else(|| {
        eprintln!(
            "No free port in {start_port}..{}",
            start_port + PORT_ATTEMPTS
        );
        std::process::exit(1);
    });

    println!("Serving {} on http://localhost:{port}", root.display());
    match lan_address() {
        Some(ip) => println!("Friends on your network can join at http://{ip}:{port}"),
        None => println!("No network address found: multiplayer works on this computer only"),
    }

    let hub = Arc::new(Hub::new(game));
    let ticker = Arc::clone(&hub);
    let tick_interval = config.tick_interval;
    thread::spawn(move || loop {
        thread::sleep(tick_interval);
        ticker.tick();
    });

    let files = Arc::new(http::FileRules {
        root,
        blocked_prefixes: config.blocked_prefixes,
        json_routes: config.json_routes,
    });
    for stream in listener.incoming().flatten() {
        let files = Arc::clone(&files);
        let hub = Arc::clone(&hub);
        thread::spawn(move || http::handle_connection(stream, &files, &hub));
    }
}

/// This computer's LAN address. Connecting a UDP socket sends nothing; it only makes
/// the OS pick the outgoing interface, whose address we then read back.
fn lan_address() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?; // TEST-NET-1: never routed anywhere
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then_some(ip)
}

fn bind_first_free(start: u16) -> Option<(TcpListener, u16)> {
    (start..start.saturating_add(PORT_ATTEMPTS)).find_map(|port| {
        TcpListener::bind(("0.0.0.0", port))
            .ok()
            .map(|listener| (listener, port))
    })
}
