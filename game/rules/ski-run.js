import { buildCourse } from '../ski/course.js';
import { CourseScene } from '../ski/course-scene.js';
import { ChaseCamera } from '../ski/chase-camera.js';
import { Rider } from '../ski/rider.js';
import { RiderBody, CRASH_LAYERS } from '../ski/rider-body.js';
import { CrashGround } from '../ski/crash-ground.js';
import { SnowTracks } from '../ski/snow-tracks.js';
import { FREERIDE_COURSE } from '../ski/course-freeride.js';
import { pickGrab, scoreAir } from '../ski/tricks.js';
import { judgeLanding, LANDING_RATINGS } from '../ski/landing.js';
import { FlickDetector } from '../../core/client/engine/flick-detector.js';
import { lerp } from '../../core/client/engine/math.js';

/*
 * SKI RUN: the rules of the mountain mode. It builds the course, puts the rider at the start gate on
 * the chosen ride, turns the player's controls into the rider's, times the run to the finish, drives
 * the chase camera, and keeps the sun's shadows around the rider. The rider moves the game's player
 * (the mode tells the game not to step it), so the third-person body and the HUD follow.
 *
 * An edge that catches (see Rider) is a crash: the rider becomes a ragdoll in the physics world, the clock
 * runs on, and the rider gets up where the body stops. Without the physics library the rider only stops.
 *
 * Controls: left / right carve, forward pushes off and then tucks, back brakes on the edge the rider is on,
 * reload starts the run again. Hold and release jump to pop. In the air: flick the mouse or the look stick to
 * spin (sideways) or flip (up and down), the directions nudge the same turns, and sprint held with a direction
 * is a grab. A landed trick gives style points; a landing the wrong way up or sideways is a crash.
 * Height in the air is gravity load: too much at the landing is a crash too, unless a press of jump just
 * before the snow (the stomp) takes it away. Tricks make the stomp stronger and its window wider.
 * The ride, a landing and a fallen body all mark the snow (see game/ski/snow-tracks.js).
 * Developer mode: the weapon slot keys jump the rider to the course's markers.
 */

const COURSES = { [FREERIDE_COURSE.id]: FREERIDE_COURSE };
export const DEFAULT_COURSE = FREERIDE_COURSE.id;
export const RIDES = ['skis', 'board'];
export const DEFAULT_RIDE = RIDES[0];
const STICK_GRAB = 0.5; // how far to the side the move stick goes to pick a sideways grab
const STICK_FULL_TUCK = 0.5; // how far forward (or back) the move stick goes for a full tuck (or brake)
const FINISH_CONTROLS = Object.freeze({ steer: 0, tuck: 0, brake: 1 }); // past the finish the rider brakes to a stop

export class SkiRun {
  /**
   * @param deps {
   *   config (CONFIG.ski), playerConfig (CONFIG.player), handsIndex (the item that is "nothing in hand"),
   *   menuLevel (the level that stands behind the menu when a run is left),
   *   world, player, cyborg, weapons, camera, renderer, skiHud,
   *   loadPhysics() (resolves to { createWorld(gravity) }; see core/client/physics/rapier-world.js),
   *   particles (a ParticlePool for the snow spray; leave it out and there is no spray)
   * }
   */
  constructor({ config, playerConfig, handsIndex, menuLevel, world, player, cyborg, weapons, camera, renderer, skiHud, loadPhysics, particles = null }) {
    this.config = config;
    this.playerConfig = playerConfig;
    this.handsIndex = handsIndex;
    this.menuLevel = menuLevel;
    this.world = world;
    this.player = player;
    this.cyborg = cyborg;
    this.weapons = weapons;
    this.camera = camera;
    this.renderer = renderer;
    this.skiHud = skiHud;
    this.particles = particles;
    this.snow = null;
    this.course = null; // set while a run is on
    this.scene = null;
    this.chase = null;
    this.rider = null;
    this.body = null;
    this.courseId = DEFAULT_COURSE;
    this.rideId = DEFAULT_RIDE;
    this.devMode = false;
    this.previousView = false;
    this.previousFar = camera.far;
    this.time = 0; // seconds since the rider first moved
    this.started = false; // the rider has left the start gate
    this.finished = false;
    this.crash = null; // { time, still, heading }: set while the rider is down
    this.physics = null; // the physics world of the current course, made at the first crash
    this.ground = null;
    this.physicsFactory = null;
    // Loaded in the background. Until it is there (or if it cannot load) a crash has no ragdoll.
    this.physicsReady = loadPhysics().then((factory) => {
      this.physicsFactory = factory;
    }).catch((error) => {
      console.error(`The physics library did not load, so crashes have no ragdoll: ${error.message}`);
    });
    this.sunCell = { x: NaN, z: NaN };
    this._subject = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
    this._controls = { steer: 0, tuck: 0, brake: 0, pop: false, stomp: false, grab: null };
    this._held = { forward: false, back: false, left: false, right: false };
    this.flicks = new FlickDetector(config.tricks.flick);
    this.style = 0; // style points of this run
    this.bannerTime = 0; // seconds the trick banner stays up
    this._pressSnow = (part, position, radius, speed) => this.snow.pressBody(part, position, radius, speed);
  }

  get active() {
    return this.course !== null;
  }

  /** Developer mode shows the marker keys and lets them jump the rider. */
  setDevMode(enabled) {
    this.devMode = enabled;
    if (this.active) this._showDevKeys();
  }

  /** Begin a run. `options` is { course, ride }; what is left out is what the last run used. */
  start(options) {
    const courseId = options?.course ?? this.courseId;
    const rideId = options?.ride ?? this.rideId;
    const definition = COURSES[courseId];
    if (!definition) throw new Error(`no course "${courseId}"`);
    if (!RIDES.includes(rideId)) throw new Error(`no ride "${rideId}"`);
    this.courseId = courseId;
    this.rideId = rideId;

    const { player, camera, config } = this;
    if (this.active) {
      this._leaveCourse(); // a restart: the old course goes first, and what stop() must restore is already saved
    } else {
      this.previousView = player.thirdPerson;
      this.previousFar = camera.far;
    }
    this.course = buildCourse(definition, config.terrain.cell);
    this.scene = new CourseScene({ course: this.course, config: config.terrain });
    this.world.group.add(this.scene.group);
    const field = this.course.heightfield;
    this.rider = new Rider({ config: { ...config.rider, ...config.rides[rideId] }, course: this.course });
    this.body = new RiderBody({
      cyborg: this.cyborg, rider: this.rider, ride: rideId, config: config.pose, crashConfig: config.crash,
      pushSpeed: config.rider.pushSpeed, heightfield: field, worldGroup: this.scene.group,
    });
    this.snow = new SnowTracks({
      heightfield: field, terrain: this.scene.terrain, group: this.scene.group, config: config.snow, ride: rideId,
      lines: [...new Set(Object.values(config.pose[rideId].feet).map((foot) => foot.x))], // one line under each ski; a board's feet are both on its middle
      particles: this.particles,
    });
    this.chase = new ChaseCamera({
      camera, config: config.camera,
      groundHeight: (x, z) => field.heightAt(x, z),
      sensitivity: () => this.playerConfig.mouseSensitivity,
      fov: () => this.playerConfig.fov,
    });

    player.thirdPerson = true; // the rider is always seen from outside
    player.tpBlend = 1;
    this.weapons.equipNow(this.handsIndex);
    camera.far = config.camera.far;
    camera.updateProjectionMatrix();

    this.skiHud.setActive(true);
    this._showDevKeys();
    this._placeRider(this.course.start);
  }

  /** Leave the mountain: take the course away and put the game back the way the other modes expect it. */
  stop() {
    if (!this.active) return;
    this._leaveCourse();
    const { player, camera } = this;
    player.thirdPerson = this.previousView;
    camera.far = this.previousFar;
    camera.fov = this.playerConfig.fov;
    camera.updateProjectionMatrix();
    this.skiHud.setActive(false);
    this.world.build(this.menuLevel);
    this.renderer.shadowMap.needsUpdate = true;
    player.reset();
    this.cyborg.reset();
  }

  _leaveCourse() {
    this.crash = null;
    this.skiHud.setAlert(null);
    this.body.dispose();
    this.snow.dispose();
    this.snow = null;
    this.ground?.dispose();
    this.physics?.dispose();
    this.ground = null;
    this.physics = null;
    this.scene.dispose();
    this.body = null;
    this.rider = null;
    this.scene = null;
    this.course = null;
    this.chase = null;
  }

  /** Stand the rider still at a point of the course, facing down it, with the clock at zero. */
  _placeRider(point) {
    this.crash = null;
    this.skiHud.setAlert(null);
    this.body.recover();
    this.snow.reset(); // before the rider is placed: it stands on the fresh snow
    this.rider.reset(point, this.course.start.yaw);
    this.body.reset();
    this.time = 0;
    this.started = false;
    this.finished = false;
    this.style = 0;
    this.bannerTime = 0;
    this.flicks.reset();
    this.skiHud.setStyle(0);
    this.skiHud.showTrick(null);
    this.skiHud.setTime(0);
    this.skiHud.showFinish(null);
    this._movePlayer();
    this.player.prevPos.copy(this.player.pos);
    this.player.pitch = 0;
    this.cyborg.reset(); // the body turns to the new heading at once
    this.chase.reset();
    this._followSun(true);
  }

  /** The game's player is where the rider is: the third-person body and everything else read the player. */
  _movePlayer() {
    const { player, rider } = this;
    player.prevPos.copy(rider.prevPos);
    player.pos.copy(rider.pos);
    player.vel.copy(rider.vel);
    player.yaw = rider.heading;
  }

  _showDevKeys() {
    if (!this.devMode) {
      this.skiHud.setDevText(null);
      return;
    }
    const keys = this.course.markers.map((marker, index) => `${index + 1} ${marker.name}`).join('  ·  ');
    this.skiHud.setDevText(`DEV  ·  ${keys}`);
  }

  /** What the player holds, as the rider's controls. A stick steers and tucks by how far it is pushed. */
  _readControls(input) {
    const controls = this._controls;
    if (input.analogActive) {
      controls.steer = input.analogX;
      controls.tuck = Math.min(1, Math.max(0, -input.analogY) / STICK_FULL_TUCK); // forward on the stick is below zero
      controls.brake = Math.min(1, Math.max(0, input.analogY) / STICK_FULL_TUCK);
    } else {
      controls.steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      controls.tuck = input.forward ? 1 : 0;
      controls.brake = input.back ? 1 : 0;
    }
    controls.pop = input.jumpHeld;
    controls.stomp = input.jumpPressed; // the same control: on the snow it charges a pop, a new press in the air is the stomp
    controls.grab = null;
    if (input.sprintHeld && !this.rider.grounded) { // the grab control with a direction: the direction picks the grab, and does not turn the ride
      const held = this._held;
      held.forward = controls.tuck > 0;
      held.back = controls.brake > 0;
      held.left = controls.steer < -STICK_GRAB;
      held.right = controls.steer > STICK_GRAB;
      controls.grab = pickGrab(held);
    }
    return controls;
  }

  /** Once per fixed step. `input` is the game's input state. */
  fixedUpdate(dt, input) {
    const { rider, course } = this;
    if (input.reloadPressed) {
      this._placeRider(course.start);
      return;
    }
    if (this.devMode && input.selectSlot >= 0 && course.markers[input.selectSlot]) {
      this._placeRider(course.markers[input.selectSlot]);
      return;
    }
    if (this.started && !this.finished) this.time += dt;
    if (this.crash) {
      this._stepCrash(dt);
      return;
    }
    const flick = this.flicks.update(dt);
    if (flick) rider.flick(flick.x * flick.strength, flick.y * flick.strength); // right spins right; down (a pull back) is a back flip
    rider.step(dt, this.finished ? FINISH_CONTROLS : this._readControls(input));
    this._movePlayer();
    this.snow.ride(dt, rider);
    if (rider.caught !== 0) this._startCrash(rider.caught);
    else if (rider.landed) this._judgeLanding(rider.landed);

    if (!this.started && rider.speed > this.config.rider.stillSpeed) this.started = true;
    if (this.started && !this.finished) {
      if (rider.pos.z <= course.finish.z) {
        this.finished = true;
        this.skiHud.showFinish(this.time);
      }
    }
  }

  /** The rider came down from the air: a crash, or style points for what it did up there. */
  _judgeLanding(landing) {
    const { tricks, landing: rules } = this.config;
    const trick = scoreAir(landing, tricks);
    const verdict = judgeLanding(landing, trick?.points ?? 0, rules);
    if (landing.crash || verdict.rating === LANDING_RATINGS.CRASH) {
      this._startCrash(landing.side);
      return;
    }
    this.body.absorb(verdict.share);
    this.snow.land(this.rider.pos, verdict.share);
    const stomped = verdict.rating === LANDING_RATINGS.STOMPED;
    const sketchy = verdict.rating === LANDING_RATINGS.SKETCHY;
    if (sketchy) this.rider.vel.multiplyScalar(rules.sketchyKeep);
    if (!trick && !stomped && !sketchy) return; // a plain, easy landing needs no words
    const share = stomped ? 1 + rules.stompedBonus : sketchy ? rules.sketchyPoints : 1;
    const points = Math.round((trick?.points ?? 0) * share);
    const words = [stomped ? 'STOMPED' : sketchy ? 'SKETCHY' : null, trick?.name, points > 0 ? `+${points}` : null].filter(Boolean);
    this.style += points;
    this.bannerTime = tricks.bannerTime;
    this.skiHud.setStyle(this.style);
    this.skiHud.showTrick(words.join('  '));
  }

  /** The rider goes down. `caught` is the edge that caught (-1 left, +1 right). */
  _startCrash(caught) {
    const { rider, config } = this;
    this.crash = { time: 0, still: 0, heading: rider.travelYaw };
    this.skiHud.setAlert('CRASH');
    this.snow.fall();
    if (!this.physicsFactory) return; // no physics library: the rider stays where it is until it gets up
    if (!this.physics) {
      this.physics = this.physicsFactory.createWorld(config.rider.gravity);
      this.ground = new CrashGround({ physics: this.physics, course: this.course, config: config.crash.ground, ...CRASH_LAYERS.ground });
    }
    this.ground.follow(rider.pos.x, rider.pos.z);
    this.body.crash(this.physics, caught);
  }

  /** One fixed step of a crash: the physics moves the body, and the rider gets up once the body has stopped. */
  _stepCrash(dt) {
    const { crash, body, player } = this;
    const limits = this.config.crash;
    crash.time += dt;
    let stopped = true;
    if (body.down) {
      this.physics.step(dt);
      body.eachDownPart(this._pressSnow);
      const at = body.downPosition;
      this.ground.follow(at.x, at.z);
      player.prevPos.copy(player.pos);
      player.pos.set(at.x, this.course.heightfield.heightAt(at.x, at.z), at.z);
      player.vel.set(0, 0, 0);
      crash.still = body.downSpeed < limits.stillSpeed ? crash.still + dt : 0;
      stopped = crash.still >= limits.stillTime || crash.time >= limits.maxTime;
    }
    if (crash.time >= limits.minTime && stopped) this._getUp();
  }

  /** The rider stands up on the ride where the body stopped, facing down the course, at rest. */
  _getUp() {
    const at = this.body.down ? this.body.downPosition.clone() : this.rider.pos.clone();
    this.crash = null;
    this.skiHud.setAlert(null);
    this.body.recover();
    this.rider.reset(at, this.course.start.yaw);
    this._movePlayer();
    this.player.prevPos.copy(this.player.pos);
    this.cyborg.reset();
  }

  /** The player moved the view: it orbits the chase camera. */
  look(dx, dy) {
    if (this.rider.grounded || this.crash) this.chase.look(dx, dy);
    else this.flicks.add(dx, dy); // in the air the mouse and the look stick do tricks
  }

  /** Once per rendered frame, before the picture is drawn. */
  applyCamera(alpha, dt) {
    const { rider, player } = this;
    const subject = this._subject;
    const down = this.crash !== null;
    const from = down ? player.prevPos : rider.prevPos; // the player is where the fallen body is
    const to = down ? player.pos : rider.pos;
    subject.x = lerp(from.x, to.x, alpha);
    subject.y = lerp(from.y, to.y, alpha);
    subject.z = lerp(from.z, to.z, alpha);
    subject.heading = down ? this.crash.heading : rider.travelYaw;
    subject.speed = this._shownSpeed();
    this.chase.update(dt, subject, this.player.tpZoom);
  }

  /** How fast the rider moves: the fallen body's speed during a crash. */
  _shownSpeed() {
    return this.body.down ? this.body.downSpeed : this.rider.speed;
  }

  /** The edge the rider is on, as the HUD names it: toeside or heelside on a board, left or right on skis. */
  _edgeName() {
    const { mountainEdge, config } = this.rider;
    if (config.toeEdge === undefined) return mountainEdge > 0 ? 'RIGHT EDGE' : 'LEFT EDGE';
    return mountainEdge === config.toeEdge ? 'TOESIDE' : 'HEELSIDE';
  }

  /** Once per rendered frame, after the simulation. `dt` is the frame time in seconds. */
  update(dt) {
    if (this.bannerTime > 0) {
      this.bannerTime -= dt;
      if (this.bannerTime <= 0) this.skiHud.showTrick(null);
    }
    this.skiHud.setSpeed(this._shownSpeed());
    this.skiHud.setEdge(this._edgeName(), this.rider.holdShare === 1);
    const inAir = !this.rider.grounded && !this.crash;
    this.skiHud.setLoad(inAir ? this.rider.air.load / this.config.landing.crashLimit : null, inAir && this.rider.air.stompAt !== null);
    if (!this.crash) this.skiHud.setAlert(this.rider.catchShare >= this.config.rider.catchWarn ? 'EDGE!' : null);
    if (!this.finished) this.skiHud.setTime(this.time);
    this.snow.update();
    this._followSun(false);
  }

  /**
   * The shadow map covers only the ground around the rider. It moves in steps of `shadow.step` metres,
   * and is drawn again only when the rider crosses into another step (or when `force` is set).
   */
  _followSun(force) {
    const { reach, step, mapSize } = this.config.shadow;
    const { pos } = this.player; // the rider, or the fallen body
    const cellX = Math.round(pos.x / step);
    const cellZ = Math.round(pos.z / step);
    if (!force && cellX === this.sunCell.x && cellZ === this.sunCell.z) return;
    this.sunCell.x = cellX;
    this.sunCell.z = cellZ;
    const x = cellX * step;
    const z = cellZ * step;
    this.world.aimSun(x, this.course.heightfield.heightAt(x, z), z, reach, mapSize);
    this.renderer.shadowMap.needsUpdate = true;
  }
}
