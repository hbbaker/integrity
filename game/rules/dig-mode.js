import * as THREE from 'three';
import { DigSite } from '../world/dig-world.js';
import { poseMessage } from '../entities/pose-message.js';

/*
 * DIG SITE on the client. The server decides everything that matters (what is buried,
 * what a dig finds, the score); this class sends dig requests, shows the results,
 * and keeps the player's view of the site: holes, revealed lines, scores, timer.
 *
 * What the client never has: any buried line or depth. It learns a line only
 * from the strike message that reveals it.
 */

const MAX_AIM_DISTANCE = 12; // metres along the crosshair ray, so a grazing aim at the horizon picks nothing
const AIM_STEP = 0.05; // metres between samples when walking the crosshair ray down to the ground
const HINT_SECONDS = 1.2;
const POINTS_BASE = 10; // display only: the server pays the real points (server/src/dig/rules.rs)
const POINTS_PER_LAYER = 5;
const POPUP_HEIGHT = 0.6;
const FEED_KIND_NAMES = { electric: 'ELECTRIC', gas: 'GAS', water: 'WATER', telecom: 'TELECOM', sewer: 'SEWER' };

const HINTS = {
  building: 'CANNOT DIG IN A BUILDING',
  locked: 'LOCKED: A LINE WAS STRUCK HERE',
  far: 'TOO FAR AWAY',
  'max-depth': 'BOTTOM OF THE HOLE',
};

export class DigMode {
  /**
   * @param deps { config, net, player, weapons, remotes, world, scene, camera, audio, hud, digHud, scoreboard }
   * config = CONFIG.dig; hud is the main HUD (damage numbers, banner); scoreboard.feed() prints the activity lines.
   */
  /** `suit` is a function that returns what the other players need to know about your mech suit (MechSuit.networkState). */
  constructor({ config, net, player, weapons, remotes, world, scene, camera, audio, hud, digHud, scoreboard, suit = () => null }) {
    this.config = config;
    this.net = net;
    this.player = player;
    this.weapons = weapons;
    this.remotes = remotes;
    this.camera = camera;
    this.world = world;
    this.audio = audio;
    this.hud = hud;
    this.digHud = digHud;
    this.scoreboard = scoreboard;
    this.suit = suit;
    this.site = new DigSite({ scene, world });

    this.active = false;
    this.ended = false; // the results are showing: nothing more can be dug
    this.solo = false; // a private one-player game (from the SANDBOX menu)
    this.players = []; // connected players, from the server's lobby messages
    this.scores = new Map(); // id -> { score, strikes }
    this.time = 0;
    this.endsAt = 0;
    this.nextDigAt = 0;
    this.swingUntil = 0;
    this.sendTimer = 0;
    this.hintUntil = 0;
    this.hintText = '';
    this.target = null; // { x, z } the tile under the crosshair, within reach
    this.focus = null; // the last tile this player dug, for the depth readout
    this.shovelIndex = weapons.cfg.list.findIndex((weapon) => weapon.id === 'shovel');

    this._origin = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._point = new THREE.Vector3();
  }

  /** Begin a match from the server's `dg_map` message. */
  start(message) {
    const { player, weapons } = this;
    this.active = true;
    this.ended = false;
    this.time = 0;
    this.endsAt = message.duration;
    this.nextDigAt = 0;
    this.swingUntil = 0;
    this.sendTimer = 0;
    this.target = null;
    this.focus = null;
    this.hintUntil = 0;
    this.players = message.players;
    this.scores = new Map(message.players.map((entry) => [entry.id, { score: 0, strikes: 0 }]));

    this.site.build(message.map);
    const [spawnX, spawnZ] = message.spawn;
    player.spawnX = spawnX + 0.5 - this.site.half;
    player.spawnY = 0;
    player.spawnZ = spawnZ + 0.5 - this.site.half;
    player.spawnYaw = 0;
    player.reset();
    player.invulnerable = true; // nothing here can hurt you except your own shovel

    weapons.reset();
    weapons.fireLocked = true; // the trigger digs; it never shoots
    weapons.select(this.shovelIndex);
    weapons.onMelee = () => this.net.sendGame({ t: 'ml', fists: 0 });

    this.remotes.sync(message.players, this.net.id);
    this.digHud.setActive(true);
    this.digHud.hideResults();
    this.scoreboard.clearFeed();
  }

  stop() {
    this.active = false;
    this.site.clear();
    this.digHud.setActive(false);
    this.scoreboard.clearFeed();
    this.weapons.fireLocked = false;
    this.weapons.onMelee = null;
    this.player.invulnerable = false;
  }

  /** The server's roster of connected players changed. */
  onLobby(message) {
    this.players = message.players;
    this.remotes.sync(message.players, this.net.id);
    for (const entry of message.players) {
      if (!this.scores.has(entry.id)) this.scores.set(entry.id, { score: 0, strikes: 0 });
    }
  }

  /**
   * The input for this fixed step. While the shovel swings you stand still; weapon keys do nothing in
   * this mode. A copy is returned so the real input (which the keyboard keeps updating) is untouched.
   */
  filterInput(input) {
    const swinging = this.time < this.swingUntil;
    return {
      ...input,
      selectSlot: -1, wheel: 0, meleePressed: false, ammoPressed: false, reloadPressed: false,
      forward: swinging ? false : input.forward,
      back: swinging ? false : input.back,
      left: swinging ? false : input.left,
      right: swinging ? false : input.right,
      jumpPressed: swinging ? false : input.jumpPressed,
      analogActive: swinging ? false : input.analogActive,
    };
  }

  /** Once per fixed step: turn a held or pressed trigger into a dig request. */
  fixedUpdate(input) {
    if (!this.active || this.ended) return;
    if (input.fireHeld || input.firePressed) this._tryDig(input.firePressed);
  }

  /** Once per rendered frame: aim, cursor, HUD, and the pose broadcast. */
  update(dt) {
    if (!this.active) return;
    this.time += dt;
    this.target = this.ended ? null : this._aimedTile();
    const diggable = this.target && this._blockReason(this.target) === null;
    this.site.setCursor(this.target, diggable);

    const shown = this.target ?? this.focus;
    const hole = shown ? this.site.holeAt(shown.x, shown.z) : { depth: 0, locked: false };
    const canDig = hole.depth + this.config.layerInches <= this.config.maxDepthInches && !hole.locked;
    this.digHud.setDepth(hole.depth, canDig ? POINTS_BASE + POINTS_PER_LAYER * (hole.depth / this.config.layerInches) : 0);
    this.digHud.setHint(this.time < this.hintUntil ? this.hintText : '');
    this.digHud.setTimer(this.ended ? 0 : this.endsAt - this.time);
    this.digHud.setBoard(this._boardRows());

    this.sendTimer -= dt;
    if (this.sendTimer <= 0 && !this.ended) {
      this.sendTimer += 1 / this.config.sendHz;
      this.net.sendGame(poseMessage(this.player, this.weapons, this.suit()));
    }
  }

  /** A server message about the match: a dig result, a refusal, or the end. */
  onMessage(message) {
    if (!this.active) return;
    switch (message.t) {
      case 'dg_dig':
        this._onDig(message);
        break;
      case 'dg_no':
        this._onRefused(message);
        break;
      case 'dg_end':
        this._onEnd(message);
        break;
      default:
        break;
    }
  }

  /* ------------------------------- internals ------------------------------- */

  /**
   * The tile under the crosshair if it is within reach, else null. The ray is walked in small steps
   * until it dips below the ground, so it finds the floor of a hole, the wall of one, or a house.
   */
  _aimedTile() {
    this.player.getAim(this._origin, this._fwd, this._right, this._up);
    for (let distance = 0; distance <= MAX_AIM_DISTANCE; distance += AIM_STEP) {
      this._point.copy(this._origin).addScaledVector(this._fwd, distance);
      if (this._point.y > this.world.groundHeight(this._point.x, this._point.z)) continue;
      const reach = Math.hypot(this._point.x - this.player.pos.x, this._point.z - this.player.pos.z);
      return reach <= this.config.reach ? this.site.tileAt(this._point.x, this._point.z) : null;
    }
    return null;
  }

  /** Why the aimed tile cannot be dug (a key into HINTS), or null when it can. */
  _blockReason(tile) {
    if (this.site.isBuilding(tile.x, tile.z)) return 'building';
    if (this.site.isLocked(tile.x, tile.z)) return 'locked';
    if (this.site.holeAt(tile.x, tile.z).depth + this.config.layerInches > this.config.maxDepthInches) return 'max-depth';
    return null;
  }

  _tryDig(justPressed) {
    const tile = this.target;
    if (!tile) {
      if (justPressed) this._hint('far');
      return;
    }
    const blocked = this._blockReason(tile);
    if (blocked) {
      if (justPressed) this._hint(blocked);
      return;
    }
    if (this.time < this.nextDigAt) return; // still recovering from the last swing

    const layers = this.site.holeAt(tile.x, tile.z).depth / this.config.layerInches;
    this.nextDigAt = this.time + this.config.cooldownBase + this.config.cooldownPerLayer * layers;
    this.swingUntil = this.time + this.config.swingTime;
    this.net.sendGame({ t: 'dg_dig', x: tile.x, z: tile.z });
    this.weapons.swingTool();
    this.focus = tile;
  }

  _hint(reason) {
    this.hintText = HINTS[reason] ?? '';
    this.hintUntil = this.time + HINT_SECONDS;
  }

  _nameOf(id) {
    return this.players.find((entry) => entry.id === id)?.name ?? '???';
  }

  _boardRows() {
    return this.players.map((entry) => {
      const stats = this.scores.get(entry.id) ?? { score: 0, strikes: 0 };
      return { name: entry.name, score: stats.score, strikes: stats.strikes, me: entry.id === this.net.id };
    });
  }

  _onDig(message) {
    const { x, z, depth, by, res } = message;
    this.site.setHole(x, z, depth, res === 'strike' ? { struck: true, kind: message.kind, line: message.reveal } : {});
    const stats = this.scores.get(by) ?? { score: 0, strikes: 0 };
    stats.score = message.score;
    if (res === 'strike') stats.strikes = message.strikes;
    this.scores.set(by, stats);

    const mine = by === this.net.id;
    const spot = this.site.tileCentre(x, z, this._point);
    spot.y = POPUP_HEIGHT;
    if (mine) this.focus = { x, z };

    if (res === 'strike') {
      this.site.reveal(message.reveal, message.kind);
      this.audio.strike();
      const kind = FEED_KIND_NAMES[message.kind] ?? message.kind.toUpperCase();
      this.scoreboard.feed(`${this._nameOf(by)} STRUCK ${kind}  -${message.pen}`, mine);
      if (mine) {
        this.hud.damage(); // the red flash
        this.hud.banner(`${kind} LINE STRUCK  -${message.pen}`);
        this.hud.damageNumber(spot, message.pen, 'crit', 1.2, 0.2);
      }
      return;
    }

    if (mine) {
      this.audio.dig(depth);
      this.hud.damageNumber(spot, message.pts, 'normal', 1, 0.2);
    } else {
      this.audio.digAt(this.camera.position.distanceTo(spot), depth);
    }
  }

  /** A dig of mine did nothing: take the server's depth for the hole so the view stays honest. */
  _onRefused(message) {
    if (message.depth > 0) this.site.setHole(message.x, message.z, message.depth, {});
    if (message.why === 'locked') this.site.markBlocked(message.x, message.z);
    if (message.why !== 'cooldown') this._hint(message.why);
  }

  _onEnd(message) {
    this.ended = true;
    this.weapons.cease();
    this.digHud.showResults(message.results, message.winner, this.net.id);
    document.exitPointerLock();
  }
}
