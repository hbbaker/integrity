/*
 * Just enough browser for game/main.js to start in Node: a DOM that records event listeners (so a test can
 * click a button or press a key), localStorage, requestAnimationFrame that hands the frame function to the
 * test, and a pad list the test can fill. Nothing is drawn.
 */
import { installDomStubs } from './modules.mjs';

const noop = () => {};

function makeElement(id = '') {
  const listeners = {};
  const classes = new Set();
  const element = {
    id, style: { setProperty: noop, removeProperty: noop }, dataset: {}, children: [], textContent: '', innerHTML: '', value: '', disabled: false, hidden: false,
    listeners,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => (on ?? !classes.has(c) ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    addEventListener: (name, fn) => { (listeners[name] ??= []).push(fn); },
    removeEventListener: noop,
    appendChild: (child) => { element.children.push(child); return child; },
    replaceChildren: (...kids) => { element.children = kids; }, append: noop, remove: noop, focus: noop, blur: noop, setAttribute: noop, removeAttribute: noop,
    querySelector: () => makeElement(), querySelectorAll: () => [], closest: () => null,
    getClientRects: () => [1], getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    getContext: () => globalThis.__ctx,
    click() { for (const fn of listeners.click ?? []) fn({ stopPropagation: noop, preventDefault: noop, target: element }); },
    requestPointerLock: () => Promise.resolve(),
    width: 0, height: 0, offsetWidth: 0,
  };
  return element;
}

/** `realWebSocket`: keep Node's own WebSocket and point the page at `host`, to talk to the real game server. */
export function installBrowser({ realWebSocket = false, host = 'localhost:1' } = {}) {
  installDomStubs();
  globalThis.__ctx = new Proxy({}, {
    get: (target, key) => {
      if (key === 'measureText') return () => ({ width: 100 });
      if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(16) });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
      return noop;
    },
    set: () => true,
  });
  const elements = new Map();
  const documentListeners = {};
  const windowListeners = {};
  const storage = new Map();
  const frames = [];
  const pads = [];

  const document = {
    createElement: (tag) => (tag === 'canvas' ? { width: 0, height: 0, getContext: () => globalThis.__ctx } : makeElement()),
    getElementById: (id) => { if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); },
    querySelector: () => makeElement(), querySelectorAll: () => [],
    addEventListener: (name, fn) => { (documentListeners[name] ??= []).push(fn); },
    body: makeElement('body'), documentElement: makeElement('html'),
    pointerLockElement: null, exitPointerLock: noop,
  };
  globalThis.document = document;
  globalThis.window = globalThis;
  globalThis.addEventListener = (name, fn) => { (windowListeners[name] ??= []).push(fn); };
  globalThis.removeEventListener = noop;
  globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, String(v)); }, removeItem: (k) => storage.delete(k) };
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads, userAgent: 'node' }, configurable: true });
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  globalThis.devicePixelRatio = 1;
  globalThis.location = { protocol: 'http:', host };
  globalThis.HTMLInputElement = class {};
  if (!realWebSocket) globalThis.WebSocket = class { static OPEN = 1; constructor() { this.readyState = 0; } send = noop; close = noop; };

  return {
    element: (id) => document.getElementById(id),
    pads,
    storage,
    /** Fire a document or window event to everything listening. */
    fire(name, event = {}) {
      const e = { preventDefault: noop, stopPropagation: noop, ...event };
      for (const fn of [...(documentListeners[name] ?? []), ...(windowListeners[name] ?? [])]) fn(e);
    },
    lockPointer(canvas) { document.pointerLockElement = canvas; },
    /** Run the queued animation frame(s) at the given clock time (ms). */
    frame(timeMs) {
      const batch = frames.splice(0);
      for (const fn of batch) fn(timeMs);
      return batch.length;
    },
  };
}
