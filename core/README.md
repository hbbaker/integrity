# Core

The reusable part of this repository. Everything under `core/` knows nothing about CABLE BOTS: it
never imports from `game/` (a test, `tests/core-boundary.test.mjs`, fails if it does). The game gets
its behaviour into the core through config objects, injected classes and registries.

```
core/
  client/             browser code (ES modules, no build step; Three.js comes from your import map)
    engine/           stage (renderer, scene, camera), loop, input, bindings, settings, gamepad, math
    graphics/         materials and procedural textures, sky, particles, tracers, muzzle flash
    audio/            a small Web Audio synth to extend with your own sounds
    character/        first-person player controller, health regeneration, spawn picking
    combat/           Holdable, the hands (HoldableSystem), Weapon and its subclasses
    net/              WebSocket client for the server core's hub
    modes/            GameMode and ModeManager
  server/             Rust crate `server-core`: HTTP files, WebSocket, JSON, RNG, the hub and GameServer
  examples/           minimal-game.js: a whole (tiny) game on the core, run by a test
```

## Start a new game on the core

Copy `core/` into your project (or keep it as a folder in a shared repo). Read
`examples/minimal-game.js` first: it is about 60 lines and shows every piece.

1. **Stage and loop.** `createStage({ canvas, fov, exposure, fogColor, fog, maxPixelRatio })` gives the
   renderer, scene, camera and sky. `new GameLoop({ fixedStep, maxFrameDelta, maxStepsPerFrame }, hooks)`
   runs a fixed-step simulation with interpolated rendering; your hooks are `beginFrame`, `fixedUpdate`,
   `endFrame` and `render`.
2. **Controls.** Describe what the player can do as an action table (see `game/ui/actions.js`):
   `{ id, label, group, hold | press, command, defaults: { keyboard, gamepad } }`. `Bindings` owns the
   layout (rebinding, conflicts, presets, saving), `ActionInput` turns control presses into fields on
   your `input` object, `DeviceInput` feeds it from the keyboard and mouse, `GamepadInput` from a pad.
   `SettingsModel` holds sensitivities and switches. Your own settings screen reads these (see
   `game/ui/settings-screen.js` for a complete one).
3. **Game modes.** Extend `GameMode`, override the hooks you need, and register it with a
   `ModeManager({ prepare, cleanup })`. `prepare(mode)` builds the level and resets the player before a
   mode starts; `cleanup` undoes it when you return to the menu. The manager forwards the game's events
   (fixed step, frame, player death, messages) to the running mode and is safe to call in the menu.
4. **Things the player holds.** Extend `Holdable` (or `Weapon`, `Firearm`, `BeamWeapon`,
   `MeleeWeapon`, `Tool`), register the class under a `type` name, and give `HoldableSystem` the
   list of items and their models. The system owns the viewmodel, switching, aiming and recoil; an
   item answers hooks such as `fixedUpdate`, `poseView`, `hudState`. To add a new kind of holdable,
   subclass `Holdable`: see `tests/holdable.test.mjs` for a complete toy example.
5. **Server (optional).** Add `server-core` as a path dependency, implement `GameServer`
   (`prefix`, `on_message`, `on_peer_message`, `on_leave`, `on_tick`) and call `run`. The core serves your
   files, runs the WebSocket at `/ws` (same origin only), checks usernames, keeps the roster, and relays
   players' messages. `core/server/examples/echo.rs` is the smallest game server.

## Rules the core keeps

- No game words: no key codes (except Escape, which the browser reserves), no item or mode names, no
  asset files. A game puts those in its config, its action table and its model builders.
- Language: files are plain `.js` because the project has no build step.
- Everything the core renders or plays is procedural: it ships no images or sounds.

## Tests

`npm test` (or `node tests/run-all.mjs`) runs the whole suite, including the server tests (build the
server first with `cargo build --release`). `cargo test` runs the Rust tests and `cargo clippy
--all-targets -- -D warnings` lints them.
