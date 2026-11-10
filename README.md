# CABLE BOTS

A browser first-person shooter prototype with a telecom and construction theme: waves of bots, a
sandbox, deathmatch against bots, LAN multiplayer deathmatch, and DIG SITE (find buried utilities
without striking one). Three.js from a CDN, no build step, no asset files, a std-only Rust server.

## Run it

```
cargo run --release -p cable-bots-server      # serves the game on http://localhost:8123 (PORT to change)
```

Open the address in a browser. Friends on your network can use the LAN address the server prints.
Keyboard and mouse or an Xbox / PlayStation pad; **SETTINGS** on the main menu rebinds every control
and sets the sensitivity.

## Layout

```
core/    the reusable engine (see core/README.md): never imports from game/
game/    CABLE BOTS itself
  main.js        starts the game: builds the objects, registers the modes, runs the loop
  config.js      every tuning number
  modes/         the five game modes (sandbox, waves, deathmatch, bots, dig site)
  rules/         match rules each mode uses
  entities/      bots, pickups, remote players
  weapons/       one file per weapon (numbers, class and model together), plus shared.js and index.js
  assets/        procedural models: the robot and the dig site's objects
  world/         level builders
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
