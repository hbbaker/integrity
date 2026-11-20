# OneShot

A browser first-person shooter prototype with a telecom and construction theme: waves of bots, a
sandbox, deathmatch against bots, LAN multiplayer deathmatch, DIG SITE (find buried utilities
without striking one) and MOUNTAIN (ski or snowboard down a course). Three.js and the Rapier physics engine from a CDN, no build step, no asset files, a std-only Rust server.

## Run it

```
cargo run --release -p oneshot-server      # serves the game on http://localhost:8123 (PORT to change)
```

Start it with `CABLE_DEV=1` to turn on developer mode: the character screen (I) gets a DEV tab that lists
every item and suit part and fits whatever you click into the slot you pick.

Open the address in a browser. Friends on your network can use the LAN address the server prints.
Keyboard and mouse or an Xbox / PlayStation pad; **SETTINGS** on the main menu rebinds every control
and sets the sensitivity.

## Run with Docker

```
cp .env.example .env                 # optional: set PORT, CABLE_DEV, DIG_MATCH_SECONDS
docker compose up --build            # serves the game on http://localhost:8123
```

| Variable | Meaning |
| --- | --- |
| `PORT` | Host port mapped to the game (default 8123) |
| `CABLE_DEV` | `1` turns on developer mode |
| `DIG_MATCH_SECONDS` | Overrides the DIG SITE match length |

Friends on your network use the host machine's IP and the mapped port (the LAN address in the container log is
the container's IP and does not apply). If you put a reverse proxy in front, it must keep the `Host` header:
the WebSocket at `/ws` rejects a request whose `Origin` host differs from `Host`.

## Layout

```
core/    the reusable engine (see core/README.md): never imports from game/
game/    OneShot itself
  main.js        starts the game: builds the objects, registers the modes, runs the loop
  config.js      every tuning number
  modes/         the six game modes (sandbox, waves, deathmatch, bots, dig site, mountain)
  rules/         match rules each mode uses
  entities/      bots, pickups, remote players
  weapons/       one file per weapon (numbers, class and model together), plus shared.js and index.js
  assets/        procedural models: the robot and the dig site's objects
  world/         level builders
  ski/           the mountain mode: courses, the rider and its pose solver, the ride models, the chase camera, crashes (ragdoll), snow tracks and spray
  ui/            HUD, menus, settings screen, on-screen keyboard, the action table
  server/        the Rust game server: DIG SITE on the core's GameServer
tests/   node tests/run-all.mjs   (headless; the server tests start the release server)
```

## Check it

```
node tests/run-all.mjs     # JavaScript tests (build the server first for the server tests)
cargo test                 # Rust tests
cargo clippy --all-targets -- -D warnings
```
