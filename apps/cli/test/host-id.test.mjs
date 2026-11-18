// hostId (~/.openmake/device-id) creation against the built CLI (run `npm run build --workspace=@openmake/cli` first).
// Every case uses a temporary HOME; the real ~/.openmake is never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { DIST, tempHome, fakeServer, runCli } from './fake-server.mjs';

const require = createRequire(import.meta.url);
const config = () => require(join(DIST, 'config.js'));

function hostIdInChild(home) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(join(DIST, 'config.js'))}).hostId())`], { env: { PATH: process.env.PATH, HOME: home } });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve(out) : reject(new Error(`child exited ${code}`))));
  });
}

test('concurrent first runs in an empty home all get the one stored hostId', async t => {
  for (let round = 0; round < 20; round++) {
    const home = tempHome(t);
    const ids = await Promise.all(Array.from({ length: 8 }, () => hostIdInChild(home)));
    const stored = readFileSync(join(home, '.openmake/device-id'), 'utf8').trim();
    assert.ok(stored, `round ${round}: file written`);
    assert.deepEqual(new Set(ids), new Set([stored]), `round ${round}: ${ids.join(',')}`);
    assert.deepEqual(readdirSync(join(home, '.openmake')).filter(f => f.endsWith('.tmp')), [], `round ${round}: no tmp left`);
  }
});

test('an existing id file is read and never rewritten', t => {
  const dir = join(tempHome(t), '.openmake');
  const file = join(dir, 'device-id');
  writeFileSync(file, 'existing-host-id\n');
  const before = statSync(file).mtimeMs;
  assert.equal(config().hostIdIn(dir), 'existing-host-id');
  assert.equal(readFileSync(file, 'utf8'), 'existing-host-id\n');
  assert.equal(statSync(file).mtimeMs, before);
});

test('the loser of the link race returns the stored value, not the one it generated', t => {
  const dir = join(tempHome(t), '.openmake');
  const id = config().hostIdIn(dir, { beforeLink: () => writeFileSync(join(dir, 'device-id'), 'winner-id') });
  assert.equal(id, 'winner-id');
  assert.equal(readFileSync(join(dir, 'device-id'), 'utf8'), 'winner-id');
  assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.tmp')), []);
});

test('an id file that stays empty is an error and is left as is', t => {
  const dir = join(tempHome(t), '.openmake');
  writeFileSync(join(dir, 'device-id'), '');
  assert.throws(() => config().hostIdIn(dir), /기기 id 파일을 만들지 못했습니다/);
  assert.equal(readFileSync(join(dir, 'device-id'), 'utf8'), '');
});

test('an unwritable home is an error and the CLI does not connect', async t => {
  const server = await fakeServer(t);
  const home = tempHome(t, { serverUrl: server.url });
  const dir = join(home, '.openmake');
  const folder = join(home, 'folder');
  mkdirSync(folder);
  chmodSync(dir, 0o500);
  let result;
  try {
    assert.throws(() => config().hostIdIn(dir), /기기 id 파일을 만들지 못했습니다/);
    result = await runCli(home, ['목표', '--dir', folder]);
  } finally {
    chmodSync(dir, 0o700); // before the temp home is removed
  }
  const { code, err } = result;
  assert.equal(code, 1);
  assert.match(err, /기기 id 파일을 만들지 못했습니다/);
  assert.equal(server.hellos.length, 0);
  assert.equal(server.requests.length, 0);
  assert.equal(existsSync(join(dir, 'device-id')), false);
});

test('a missing config dir is created with the id file', t => {
  const dir = join(tempHome(t), 'nested', '.openmake');
  const id = config().hostIdIn(dir);
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(readFileSync(join(dir, 'device-id'), 'utf8').trim(), id);
});
