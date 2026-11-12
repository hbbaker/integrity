/*
 * OLE RELIABLE: a six-shot hand cannon, shaped like a classic single-action revolver (octagonal barrel, ejector rod, spur
 * hammer, plow-handle grip) with western ornament: brass trim, a fluted cylinder, scrollwork and grip medallions.
 * The tech shows through the ornament: the engraving and medallions glow in the RGB cycle, and the cylinder carries ammo lamps. Hold the trigger and it fires full auto, but every shot comes a beat after the
 * pull (SHOT_DELAY) and the cylinder turns one chamber each time. Without the sights the hit volume is much bigger
 * (hipPelletRadius), so it lands when you point it near a target; on the sights the volume is small and the spread tight.
 * The six lamps on the back of the cylinder show which chambers still hold a round.
 * A reload swings the cylinder out, drops the spent shells, slides new rounds in and swings it shut; taking the gun
 * out twirls it round the grip.
 */

import * as THREE from 'three';
import { box, at, bevelBox, lathePart, glowMaterial, sideProfile, tubePart } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm, glowRing, makeHeat, rgbGlows } from './shared.js';
import { Firearm } from '../../core/client/combat/firearm.js';
import { clamp, easeInOut } from '../../core/client/engine/math.js';
import { material } from '../../core/client/graphics/materials.js';

/* ------------------------------ tuned numbers ------------------------------ */
export const SHOT_DELAY = 0.07; // on the sights: seconds from the trigger pull to the shot leaving (lower = snappier)
export const SHOT_INTERVAL = 0.25; // on the sights: seconds after a shot before the next pull can fire (full auto cadence)
export const HIP_SHOT_DELAY = 0.04; // on the hip: the same two numbers, faster. They blend into the sights values as you aim
export const HIP_SHOT_INTERVAL = 0.13;
const RELOAD_TIME = 2.0; // seconds for the whole reload animation
const TWIRL_TIME = 0.7; // seconds the draw twirl takes
const TWIRL_TURNS = 1; // full turns round the grip during the draw

const CHAMBERS = 6;
const CHAMBER_RING_RADIUS = 0.017;
const CYLINDER_RADIUS = 0.028;
const LAMP_LIT = 2.2;
const LAMP_SPENT = 0.1;
const CYLINDER_TURN_RATE = 14; // how fast the cylinder catches up with its target angle (per second)
const CRANE_OPEN_ANGLE = 1.25; // radians the cylinder swings out to the left
const SHELL_DROP = 0.3; // metres a shell falls
const SHELL_SLIDE = 0.045; // metres a shell slides out of its chamber before it falls
const TWIRL_PIVOT = { y: -0.07, z: 0.13 }; // the twirl turns the gun round a point in the grip

/** 0 before `from`, 1 after `to`, eased in between. */
const ramp = (p, from, to) => easeInOut(clamp((p - from) / (to - from), 0, 1));

/** The numbers: damage, speed, ammo, recoil, sights. */
export const config = {
  id: 'revolver', name: 'OLE RELIABLE', type: 'firearm', auto: true, fireDelay: SHOT_DELAY, interval: SHOT_INTERVAL, hipFireDelay: HIP_SHOT_DELAY, hipInterval: HIP_SHOT_INTERVAL,
  damage: 52, mag: 6, reserve: 36, maxReserve: 54, reloadTime: RELOAD_TIME, critMul: 1.7,
  spread: 0.006, pellets: 1, range: 120, falloffStart: 18, falloffEnd: 45, falloffMin: 0.55,
  pelletRadius: 0.05, hipPelletRadius: 0.25, // hit volume on the sights / on the hip
  knockback: 6, stun: 0.2, camKick: 0.05, camYaw: 0.01, climb: 0.007, kickZ: 0.05, kickRot: 0.14,
  flashSize: 0.5, worldLight: 35, heat: 10, tracerColor: 0xffd27a,
  ads: { x: 0, y: -0.088, z: -0.3, fovDrop: 14 }, // the sight tops are at y = 0.078
};

// Side outlines in [z, y] (forward is -z).
const REAR_FRAME = [[0.048, 0.052], [0.11, 0.052], [0.125, 0.04], [0.132, 0.01], [0.118, -0.02], [0.07, -0.04], [0.048, -0.03]]; // behind the cylinder
const FRONT_FRAME = [[-0.078, 0.046], [-0.045, 0.046], [-0.045, -0.03], [-0.078, -0.03]]; // in front of the cylinder: the barrel web
const GRIP = [[0.088, -0.03], [0.138, -0.03], [0.168, -0.065], [0.188, -0.12], [0.18, -0.172], [0.132, -0.178], [0.118, -0.12], [0.098, -0.06]]; // plow-handle curve
const HAMMER = [[0, 0], [0.016, 0.002], [0.03, 0.018], [0.032, 0.026], [0.02, 0.024], [0.008, 0.016], [-0.004, 0.008]]; // the spur points back
const WOOD_COLOR = 0x5a3820;
const BRASS_COLOR = 0xc9a24a;
const SCROLL_TURNS = 1.6; // turns of an engraved scroll
const SCROLL_POINTS = 22;

/** An engraved scroll: a glowing spiral on the side of the frame (side = -1 or 1), centred at [z, y] with radius r. */
function scrollwork(side, cz, cy, r, mat) {
  const points = [];
  for (let i = 0; i < SCROLL_POINTS; i++) {
    const t = i / (SCROLL_POINTS - 1);
    const angle = t * SCROLL_TURNS * Math.PI * 2;
    const radius = r * (1 - 0.8 * t);
    points.push([side * 0.0137, cy + Math.sin(angle) * radius, cz + Math.cos(angle) * radius * side]);
  }
  return tubePart(points, 0.0013, mat, 20);
}

function buildRevolver() {
  const root = new THREE.Group();
  const gun = new THREE.Group(); // everything but the hands: the draw twirl turns this
  const twirlPivot = at(new THREE.Group(), 0, TWIRL_PIVOT.y, TWIRL_PIVOT.z);
  gun.position.set(0, -TWIRL_PIVOT.y, -TWIRL_PIVOT.z); // cancels the pivot, so the gun's coordinates stay the model's coordinates
  twirlPivot.name = 'twirl';
  twirlPivot.add(gun);
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.25, -0.5, 1]), 0.05, -0.1, 0.14);
  const leftArm = at(makeArm(-1, Math.PI / 2, [-0.25, -0.5, 1]), -0.05, -0.11, 0.13);

  const brass = material(BRASS_COLOR, { metalness: 0.8, roughness: 0.35 });
  const wood = material(WOOD_COLOR, { metalness: 0.05, roughness: 0.6 });
  const stripe = glowMaterial(0xffffff, 1.4); // engraving, inlays and medallions: tinted by the RGB cycle

  const crane = at(new THREE.Group(), -0.015, -0.026, 0); // the hinge the cylinder swings out on
  crane.name = 'crane';
  const cylinder = at(new THREE.Group(), 0.015, 0.036, 0.045); // turns one chamber per shot
  crane.add(cylinder);
  cylinder.add(lathePart([[CYLINDER_RADIUS, 0], [CYLINDER_RADIUS, 0.09]], MAT.gunmetal, 12));
  cylinder.add(lathePart([[CYLINDER_RADIUS + 0.0015, 0], [CYLINDER_RADIUS + 0.0015, 0.008]], brass, 12)); // brass bands at both ends
  cylinder.add(at(lathePart([[CYLINDER_RADIUS + 0.0015, 0], [CYLINDER_RADIUS + 0.0015, 0.008]], brass, 12), 0, 0, -0.082));
  const lamps = [];
  const shells = [];
  for (let i = 0; i < CHAMBERS; i++) {
    const angle = (i / CHAMBERS) * Math.PI * 2;
    const chamberX = Math.cos(angle) * CHAMBER_RING_RADIUS;
    const chamberY = Math.sin(angle) * CHAMBER_RING_RADIUS;
    const lamp = glowMaterial(0x00f0ff, LAMP_LIT);
    lamps.push(lamp);
    const bead = at(lathePart([[0.0045, 0], [0.0045, 0.004]], lamp, 6), chamberX, chamberY, 0.002);
    bead.rotation.x = Math.PI; // the bead faces back, towards the shooter
    cylinder.add(bead);
    const flutedAngle = angle + Math.PI / CHAMBERS; // a flute between each pair of chambers
    const flute = at(box(0.006, 0.01, 0.05, MAT.rubber), Math.cos(flutedAngle) * CYLINDER_RADIUS, Math.sin(flutedAngle) * CYLINDER_RADIUS, -0.045);
    flute.rotation.z = flutedAngle - Math.PI / 2;
    cylinder.add(flute);
    const shell = at(lathePart([[0.0048, 0], [0.0048, 0.03], [0.004, 0.033]], brass, 6), chamberX, chamberY, -0.005);
    shell.name = 'shell';
    shell.visible = false; // only drawn during a reload
    cylinder.add(shell);
    shells.push({ mesh: shell, x: chamberX, y: chamberY, z: shell.position.z });
  }

  // Octagonal barrel (an 8-sided lathe), a brass band at its root, the ejector rod under it, and the glowing muzzle ring.
  const barrel = at(lathePart([[0.0145, 0], [0.0145, 0.285], [0.0175, 0.285], [0.0175, 0.295], [0.0125, 0.295]], MAT.gunmetal, 8), 0, 0.032, -0.05);
  const barrelBand = at(lathePart([[0.0185, 0], [0.0185, 0.008]], brass, 8), 0, 0.032, -0.05);
  const ejector = at(lathePart([[0.0075, 0], [0.0075, 0.2], [0.0105, 0.2], [0.0105, 0.215]], MAT.steel, 8), 0.0185, 0.004, -0.05);
  const barrelGlow = [-1, 1].map((side) => at(box(0.0012, 0.004, 0.2, stripe), side * 0.0148, 0.032, -0.19)); // glow inlay along both flats
  const heat = glowRing(0.0178, -0.34, 0.032, 0.008);
  const glows = rgbGlows([[heat.material, 0], [stripe, 0.5]]);

  const rearSights = [-0.009, 0.009].map((x) => at(box(0.006, 0.026, 0.012, MAT.gunmetal), x, 0.065, 0.1));
  const frontSight = at(box(0.006, 0.03, 0.012, MAT.gunmetal), 0, 0.063, -0.335);
  const frontDot = at(new THREE.Mesh(new THREE.SphereGeometry(0.0035, 6, 4), stripe), 0, 0.0775, -0.336);

  // The frame: rear block, barrel web, and straps over and under the cylinder window.
  const frame = [
    at(sideProfile(REAR_FRAME, 0.026, MAT.gunmetal, 0.006), 0, 0, 0),
    at(sideProfile(FRONT_FRAME, 0.026, MAT.gunmetal, 0.004), 0, 0, 0),
    at(box(0.016, 0.01, 0.1, MAT.gunmetal), 0, 0.047, 0), // top strap
    at(box(0.02, 0.008, 0.1, MAT.alloy), 0, -0.026, 0), // bottom strap
    at(box(0.0014, 0.004, 0.07, stripe), 0.0135, 0.036, 0.09), // glow inlay along the top of the frame
    scrollwork(1, 0.093, 0.01, 0.017, stripe),
    scrollwork(-1, 0.093, 0.01, 0.017, stripe),
    scrollwork(1, -0.062, 0.008, 0.012, stripe),
    scrollwork(-1, -0.062, 0.008, 0.012, stripe),
  ];

  // Spur hammer, curved trigger guard and trigger.
  const hammer = at(new THREE.Group(), 0, 0.048, 0.108);
  hammer.add(sideProfile(HAMMER, 0.008, MAT.steel, 0.002));
  const guard = tubePart([[0, -0.034, 0.062], [0, -0.062, 0.072], [0, -0.075, 0.092], [0, -0.07, 0.115], [0, -0.045, 0.128]], 0.0045, brass);
  const trigger = at(bevelBox(0.006, 0.022, 0.008, MAT.steel, 0.002), 0, -0.04, 0.1);

  // Plow-handle grip: wood panels, a brass backstrap, and a medallion on each side that glows.
  const gripParts = [
    at(sideProfile(GRIP, 0.034, wood, 0.008), 0, 0, 0),
    tubePart([[0, -0.03, 0.138], [0, -0.065, 0.171], [0, -0.12, 0.192], [0, -0.172, 0.184]], 0.004, brass),
    at(lathePart([[0.0, 0], [0.0125, 0], [0.0125, 0.002]], brass, 10), 0, -0.1, 0.146),
  ];
  for (const side of [-1, 1]) {
    const ring = at(lathePart([[0.006, 0], [0.012, 0], [0.012, 0.0025], [0.006, 0.0025]], brass, 10), side * 0.0172, -0.1, 0.146);
    const star = at(lathePart([[0, 0], [0.006, 0], [0.006, 0.003]], stripe, 6), side * 0.0178, -0.1, 0.146);
    ring.rotation.y = star.rotation.y = side * Math.PI / 2;
    gripParts.push(ring, star);
  }
  gripParts.splice(2, 1); // the loose disc above is replaced by the medallions

  const muzzle = at(new THREE.Object3D(), 0, 0.032, -0.345);
  gun.add(
    crane, barrel, barrelBand, ejector, ...barrelGlow, heat.ring,
    ...frame, hammer, guard, trigger, ...gripParts,
    ...rearSights, frontSight, frontDot, muzzle,
  );
  root.add(twirlPivot, rightArm, leftArm);
  const cool = makeHeat();
  let turn = 0; // the cylinder's current angle

  /** The reload: swing out, shells slide out and fall, new rounds rise and slide in, swing shut. `fired` chambers are emptied. */
  function animateReload(p, fired) {
    crane.rotation.z = CRANE_OPEN_ANGLE * (ramp(p, 0.08, 0.24) - ramp(p, 0.86, 0.98));
    const tilt = crane.rotation.z + cylinder.rotation.z; // the shells' parent is turned by this: counter-turn their offsets so they fall straight down
    const sin = Math.sin(tilt);
    const cos = Math.cos(tilt);
    shells.forEach((shell, i) => {
      const out = ramp(p, 0.28 + 0.015 * i, 0.38 + 0.015 * i); // slides out of the chamber
      const fall = ramp(p, 0.36 + 0.015 * i, 0.5 + 0.015 * i); // drops away
      const rise = ramp(p, 0.56 + 0.02 * i, 0.65 + 0.02 * i); // a new round comes up from below
      const push = ramp(p, 0.65 + 0.02 * i, 0.74 + 0.02 * i); // and slides home
      const falling = p < 0.56 + 0.02 * i;
      const slide = falling ? out : 1 - push;
      const drop = falling ? fall : 1 - rise;
      shell.mesh.visible = i < fired && p > 0.28 + 0.015 * i && !(falling && fall >= 1) && push < 1;
      shell.mesh.position.set(shell.x - SHELL_DROP * drop * sin, shell.y - SHELL_DROP * drop * cos, shell.z + SHELL_SLIDE * slide);
    });
    lamps.forEach((lamp, i) => { lamp.emissiveIntensity = i < fired && p < 0.74 + 0.02 * i ? LAMP_SPENT : LAMP_LIT; });
  }

  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.42 },
    parts: { support: { object: leftArm, baseY: leftArm.position.y } },
    animate(dt, time, state) {
      glows(time);
      const hot = cool(dt, state.pulse);
      heat.material.emissiveIntensity = 0.4 + hot * 7;
      const fired = state.capacity - state.rounds;
      const target = (fired / CHAMBERS) * Math.PI * 2 * (state.reloading ? 0 : 1);
      turn += (target - turn) * Math.min(1, CYLINDER_TURN_RATE * dt);
      cylinder.rotation.z = turn;
      if (state.reloading) {
        animateReload(state.reloadProgress, fired);
      } else {
        crane.rotation.z = 0;
        shells.forEach((shell) => { shell.mesh.visible = false; });
        lamps.forEach((lamp, i) => { lamp.emissiveIntensity = i < fired ? LAMP_SPENT : LAMP_LIT; });
      }
      hammer.rotation.x = -state.pulse * 0.6; // thrown back by the shot, falls as the next one gets ready
      twirlPivot.rotation.x = Math.PI * 2 * TWIRL_TURNS * ramp(state.equipAge, 0, TWIRL_TIME); // the draw twirl
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'firearm', class: Firearm },
  model: { build: buildRevolver },
};
