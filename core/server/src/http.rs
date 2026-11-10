//! Static file serving and the WebSocket upgrade, on one port.
//!
//! Every connection is one HTTP request: either a file from the game folder, or an upgrade
//! to the hub's WebSocket (path `/ws`, same origin only).

use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::hub::{self, GameServer, Hub};

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

pub fn handle_connection<G: GameServer>(
    mut stream: TcpStream,
    files: &FileRules,
    hub: &Arc<Hub<G>>,
) {
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

    match files.resolve(target) {
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

fn upgrade_to_websocket<G: GameServer>(mut stream: TcpStream, head: &str, hub: &Arc<Hub<G>>) {
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

/// Which files may be served.
pub struct FileRules {
    /// The (canonical) folder that holds the game's files.
    pub root: PathBuf,
    /// Paths under `root` that start with one of these are never served (the server's own source, tests, manifests).
    pub blocked_prefixes: Vec<String>,
}

impl FileRules {
    /// Map a request target to a file under `root`. Returns None for anything unsafe or not on the
    /// allow-list: path traversal, hidden files, blocked folders, odd types.
    pub fn resolve(&self, target: &str) -> Option<(PathBuf, &'static str)> {
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
        if relative.starts_with('.')
            || relative.contains("/.")
            || self
                .blocked_prefixes
                .iter()
                .any(|prefix| relative.starts_with(prefix.as_str()))
        {
            return None;
        }

        let extension = Path::new(relative)
            .extension()?
            .to_str()?
            .to_ascii_lowercase();
        let mime = MIME_TYPES.iter().find(|(ext, _)| *ext == extension)?.1;

        // Canonicalise and re-check containment so symlinks cannot escape the root.
        let full = self.root.join(relative).canonicalize().ok()?;
        if !full.starts_with(&self.root) {
            return None;
        }
        Some((full, mime))
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn rules(name: &str) -> (FileRules, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("server-core-http-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("game")).unwrap();
        fs::create_dir_all(root.join("tests")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        for file in [
            "index.html",
            "game/main.js",
            "tests/a.mjs",
            "notes.rs",
            ".git/config.txt",
            "package.json",
        ] {
            fs::write(root.join(file), "x").unwrap();
        }
        let root = root.canonicalize().unwrap();
        let files = FileRules {
            root: root.clone(),
            blocked_prefixes: vec!["tests/".to_owned()],
        };
        (files, root)
    }

    #[test]
    fn should_serve_the_index_when_the_target_is_the_root() {
        let (files, root) = rules("index");
        let (path, mime) = files.resolve("/").unwrap();
        assert_eq!(path, root.join("index.html"));
        assert_eq!(mime, "text/html; charset=utf-8");
    }

    #[test]
    fn should_serve_a_module_from_a_subfolder_with_a_javascript_type_when_it_exists() {
        let (files, _) = rules("module");
        let (_, mime) = files.resolve("/game/main.js?v=3").unwrap();
        assert_eq!(mime, "text/javascript; charset=utf-8");
    }

    #[test]
    fn should_refuse_path_tricks_and_hidden_files() {
        let (files, _) = rules("tricks");
        for target in [
            "/../etc/passwd",
            "/game/../../x.js",
            "/%2e%2e/x.js",
            "/.git/config.txt",
            "/game/.hidden.js",
            "/a\\b.js",
        ] {
            assert!(
                files.resolve(target).is_none(),
                "{target} should be refused"
            );
        }
    }

    #[test]
    fn should_refuse_blocked_folders_and_unknown_types() {
        let (files, _) = rules("blocked");
        assert!(files.resolve("/tests/a.mjs").is_none());
        assert!(files.resolve("/notes.rs").is_none());
        assert!(files.resolve("/missing.js").is_none());
    }
}
