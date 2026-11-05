//! Static file server for the Cable Bots prototype. Standard library only.
//!
//! Serves the game folder (the parent of `server/`) over HTTP. The port is taken
//! from the PORT env var (default 8123); if it is busy, the next ports are tried.
//! The same port also hosts the multiplayer relay on the WebSocket path `/ws`.

mod hub;
mod websocket;

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use hub::Hub;

const DEFAULT_PORT: u16 = 8123;
const PORT_ATTEMPTS: u16 = 20;
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const WEBSOCKET_PATH: &str = "/ws";
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// Only these file types are ever served; everything else is a 404.
/// ES modules MUST be served as a JavaScript MIME type or browsers refuse them.
const MIME_TYPES: &[(&str, &str)] = &[
    ("html", "text/html; charset=utf-8"),
    ("js", "text/javascript; charset=utf-8"),
    ("mjs", "text/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("json", "application/json"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("ico", "image/x-icon"),
    ("txt", "text/plain; charset=utf-8"),
];

fn main() {
    let root = game_root();
    let start_port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_PORT);

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

    let hub = Arc::new(Hub::new());
    for stream in listener.incoming().flatten() {
        let root = root.clone();
        let hub = Arc::clone(&hub);
        thread::spawn(move || handle_connection(stream, &root, &hub));
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

/// The game folder: GAME_DIR if set, otherwise the parent of this crate.
fn game_root() -> PathBuf {
    let dir = env::var("GAME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join(".."));
    dir.canonicalize().unwrap_or_else(|error| {
        eprintln!("Cannot open game folder {}: {error}", dir.display());
        std::process::exit(1);
    })
}

fn bind_first_free(start: u16) -> Option<(TcpListener, u16)> {
    (start..start.saturating_add(PORT_ATTEMPTS)).find_map(|port| {
        TcpListener::bind(("0.0.0.0", port))
            .ok()
            .map(|listener| (listener, port))
    })
}

fn handle_connection(mut stream: TcpStream, root: &Path, hub: &Arc<Hub>) {
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let Some(head) = read_request_head(&mut stream) else {
        return;
    };

    let request_line = head.lines().next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or("/"));

    if method != "GET" && method != "HEAD" {
        respond(
            &mut stream,
            405,
            "Method Not Allowed",
            "text/plain",
            b"405",
            false,
        );
        return;
    }

    if target.split(['?', '#']).next() == Some(WEBSOCKET_PATH) {
        upgrade_to_websocket(stream, &head, hub);
        return;
    }

    match resolve_path(root, target) {
        Some((path, mime)) => match fs::read(&path) {
            Ok(body) => respond(&mut stream, 200, "OK", mime, &body, method == "HEAD"),
            Err(_) => respond(
                &mut stream,
                404,
                "Not Found",
                "text/plain",
                b"404",
                method == "HEAD",
            ),
        },
        None => respond(
            &mut stream,
            404,
            "Not Found",
            "text/plain",
            b"404",
            method == "HEAD",
        ),
    }
}

fn upgrade_to_websocket(mut stream: TcpStream, head: &str, hub: &Arc<Hub>) {
    let wants_upgrade =
        header(head, "upgrade").is_some_and(|value| value.eq_ignore_ascii_case("websocket"));
    let Some(key) = header(head, "sec-websocket-key").filter(|_| wants_upgrade) else {
        respond(&mut stream, 400, "Bad Request", "text/plain", b"400", false);
        return;
    };
    // A page from another site must not be able to drive the game server from a visitor's browser.
    if !origin_matches_host(head) {
        respond(&mut stream, 403, "Forbidden", "text/plain", b"403", false);
        return;
    }
    let _ = hub::serve(hub, stream, key);
}

/// True when the request has no Origin (not a browser) or its Origin names the same host we were called as.
fn origin_matches_host(head: &str) -> bool {
    let Some(origin) = header(head, "origin") else {
        return true;
    };
    let origin_host = origin.split("://").nth(1).unwrap_or("");
    header(head, "host").is_some_and(|host| host.eq_ignore_ascii_case(origin_host))
}

/// The value of a request header (name compared without case).
fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().skip(1).find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim().eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

/// Read until the end of the request headers and return the whole header block.
fn read_request_head(stream: &mut TcpStream) -> Option<String> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while buffer.len() < MAX_REQUEST_BYTES && !buffer.windows(4).any(|w| w == b"\r\n\r\n") {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    Some(String::from_utf8_lossy(&buffer).into_owned())
}

/// Map a request target to a file under `root`. Returns None for anything unsafe
/// or not on the allow-list: path traversal, the server's own source, odd types.
fn resolve_path(root: &Path, target: &str) -> Option<(PathBuf, &'static str)> {
    let path_part = target.split(['?', '#']).next().unwrap_or("/");
    let relative = path_part.trim_start_matches('/');
    let relative = if relative.is_empty() {
        "index.html"
    } else {
        relative
    };

    if relative.contains("..")
        || relative.contains('\\')
        || relative.contains('\0')
        || relative.contains('%')
    {
        return None;
    }
    if relative.starts_with("server/") || relative.starts_with('.') {
        return None;
    }

    let extension = Path::new(relative)
        .extension()?
        .to_str()?
        .to_ascii_lowercase();
    let mime = MIME_TYPES.iter().find(|(ext, _)| *ext == extension)?.1;

    // Canonicalise and re-check containment so symlinks cannot escape the root.
    let full = root.join(relative).canonicalize().ok()?;
    if !full.starts_with(root) {
        return None;
    }
    Some((full, mime))
}

fn respond(
    stream: &mut TcpStream,
    code: u16,
    reason: &str,
    mime: &str,
    body: &[u8],
    head_only: bool,
) {
    let header = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
}
