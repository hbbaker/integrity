/*
 * The Core must stay reusable: nothing under core/ may import game code, and no game words
 * (key codes, action names) may be hard-coded in it. Escape is the one key the engine owns,
 * because the browser reserves it for releasing the pointer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './support/modules.mjs';

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

function listFiles(dir, extension) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, extension);
    return entry.name.endsWith(extension) ? [full] : [];
  });
}

const coreDir = path.join(ROOT, 'core');
const gameDir = path.join(ROOT, 'game');
const IMPORT = /(?:import|export)\s[^'"]*?from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g;
const KEY_CODE = /'(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Tab|Shift(Left|Right)|Control(Left|Right))'/;

for (const file of [...listFiles(path.join(coreDir, 'client'), '.js'), ...listFiles(path.join(coreDir, 'examples'), '.js')]) {
  const name = path.relative(ROOT, file);
  const source = fs.readFileSync(file, 'utf8');
  const escapes = [...source.matchAll(IMPORT)]
    .map((match) => match[1] ?? match[2])
    .filter((spec) => spec.startsWith('.'))
    .filter((spec) => !path.resolve(path.dirname(file), spec).startsWith(coreDir));
  check(escapes.length === 0, `${name} imports only core code ${escapes.join()}`);
  // The example is a tiny game, so it names its own keys; the engine itself must not.
  if (!file.includes(`${path.sep}examples${path.sep}`)) check(!KEY_CODE.test(source), `${name} hard-codes no key codes`);
  check(!path.resolve(file).startsWith(gameDir), `${name} is not in game/`);
}

// The Rust core must not depend on the game's server crate or mention the game.
const coreManifest = fs.readFileSync(path.join(coreDir, 'server/Cargo.toml'), 'utf8');
check(!/path\s*=/.test(coreManifest), 'core/server depends on no other crate in the repository');
for (const file of listFiles(path.join(coreDir, 'server/src'), '.rs')) {
  const source = fs.readFileSync(file, 'utf8');
  check(!/cable[_-]bots|crate::dig|dig_server/i.test(source), `${path.relative(ROOT, file)} does not mention the game`);
}

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
