/*
 * Imports every JavaScript module in the game (everything except main.js, which needs a real
 * page) with Node stand-ins for the browser. A wrong import path after a file move fails here
 * at once, with the module's name, instead of as a blank page in the browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, installDomStubs } from './support/modules.mjs';

installDomStubs();
globalThis.location = { protocol: 'http:', host: 'localhost:8123' };

const SKIP_DIRS = new Set(['node_modules', 'tests', 'server', '.git', 'target']);
const ENTRY_POINTS = new Set(['main.js']); // pages: they start the game when imported

function listModules(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : listModules(full);
    return entry.name.endsWith('.js') && !ENTRY_POINTS.has(entry.name) ? [full] : [];
  });
}

let fails = 0;
for (const file of listModules(ROOT)) {
  const name = path.relative(ROOT, file);
  try {
    await import(pathToFileURL(file).href);
    console.log(`ok  : ${name} loads`);
  } catch (error) {
    fails += 1;
    console.log(`FAIL: ${name} does not load: ${error.message}`);
  }
}
process.exit(fails ? 1 : 0);
