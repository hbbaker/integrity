/*
 * Runs every test file in its own Node process and prints a one-line result for each.
 * The files under tests/server need the game server: it is started here on a test
 * port with a short DIG SITE match (the dig-server test expects 14 seconds).
 *
 *   node tests/run-all.mjs            everything
 *   node tests/run-all.mjs smoke      only files whose name contains "smoke"
 *
 * A test fails when its process exits non-zero or prints a line starting with FAIL.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './support/modules.mjs';

const TEST_PORT = '18123';
const SERVER_BINARY = path.join(ROOT, 'target/release/cable-bots-server');
const SERVER_MATCH_SECONDS = '14';
const SERVER_START_MS = 800;

const filter = process.argv[2] ?? '';
const clientTests = fs.readdirSync(path.join(ROOT, 'tests')).filter((name) => name.endsWith('.test.mjs'));
const serverTests = fs.readdirSync(path.join(ROOT, 'tests/server')).filter((name) => name.endsWith('.test.mjs')).map((name) => `server/${name}`);
const wanted = [...clientTests, ...serverTests].filter((name) => name.includes(filter));

function runTest(name) {
  const result = spawnSync('node', [path.join(ROOT, 'tests', name)], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, TEST_PORT }, timeout: 280000,
  });
  const output = `${result.stdout}${result.stderr}`;
  const failLines = output.split('\n').filter((line) => line.startsWith('FAIL'));
  const passed = result.status === 0 && failLines.length === 0;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}`);
  if (!passed) console.log(output.split('\n').filter((line) => !line.startsWith('ok')).slice(-15).join('\n'));
  return passed;
}

async function withServer(run) {
  if (!fs.existsSync(SERVER_BINARY)) {
    console.log('SKIP  server tests (build the server first: cargo build --release)');
    return [];
  }
  const server = spawn(SERVER_BINARY, [], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: TEST_PORT, DIG_MATCH_SECONDS: SERVER_MATCH_SECONDS },
  });
  await new Promise((resolve) => setTimeout(resolve, SERVER_START_MS));
  try {
    return run();
  } finally {
    server.kill();
  }
}

const results = wanted.filter((name) => !name.startsWith('server/')).map(runTest);
const serverWanted = wanted.filter((name) => name.startsWith('server/'));
if (serverWanted.length) results.push(...await withServer(() => serverWanted.map(runTest)));

const failed = results.filter((passed) => !passed).length;
console.log(failed ? `\n${failed} of ${results.length} test files FAILED` : `\nALL ${results.length} test files passed`);
process.exit(failed ? 1 : 0);
