// One browser owner per PC among CLI processes (~/.openmake/browser-owner.lock), against the built CLI
// (run `npm run build --workspace=@openmake/cli` first). Every case uses a temporary dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DIST, tempHome } from './fake-server.mjs';

const require = createRequire(import.meta.url);
const owner = () => require(join(DIST, 'browser-owner.js'));
const LOCK = 'browser-owner.lock';

const tempDir = t => join(tempHome(t), '.openmake');
const readLock = dir => JSON.parse(readFileSync(join(dir, LOCK), 'utf8'));
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;
const writeLock = (dir, pid, token = randomUUID()) => { writeFileSync(join(dir, LOCK), JSON.stringify({ pid, token })); return token; };
const leftovers = dir => readdirSync(dir).filter(f => f !== LOCK);

test('takes the lock when there is none', t => {
  const dir = tempDir(t);
  const r = owner().acquireBrowserOwner(dir);
  assert.equal(r.owned, true);
  assert.deepEqual(readLock(dir), { pid: process.pid, token: r.token });
  assert.deepEqual(leftovers(dir), []);
});

test('a live owner keeps the lock and the message names its pid and the lock path', t => {
  const dir = tempDir(t);
  const token = writeLock(dir, process.ppid);
  const r = owner().acquireBrowserOwner(dir);
  assert.equal(r.owned, false);
  assert.ok(r.message.includes(`pid ${process.ppid}`), r.message);
  assert.ok(r.message.includes(join(dir, LOCK)), r.message);
  assert.equal(readLock(dir).token, token);
});

test('a dead owner is reclaimed with a new token and nothing is left behind', t => {
  const dir = tempDir(t);
  const old = writeLock(dir, deadPid());
  const r = owner().acquireBrowserOwner(dir);
  assert.equal(r.owned, true);
  assert.notEqual(r.token, old);
  assert.deepEqual(readLock(dir), { pid: process.pid, token: r.token });
  assert.deepEqual(leftovers(dir), []);
});

test('a broken lock or a non-UUID token counts as taken', t => {
  for (const content of ['not json', JSON.stringify({ pid: deadPid(), token: '../x' }), JSON.stringify({ token: randomUUID() })]) {
    const dir = tempDir(t);
    writeFileSync(join(dir, LOCK), content);
    const r = owner().acquireBrowserOwner(dir);
    assert.equal(r.owned, false, content);
    assert.equal(readFileSync(join(dir, LOCK), 'utf8'), content);
    assert.deepEqual(leftovers(dir), []);
  }
});

test('release removes only a lock that still carries its own token', t => {
  const dir = tempDir(t);
  const r = owner().acquireBrowserOwner(dir);
  owner().releaseBrowserOwner(dir, randomUUID());
  assert.equal(existsSync(join(dir, LOCK)), true);
  owner().releaseBrowserOwner(dir, r.token);
  assert.equal(existsSync(join(dir, LOCK)), false);
});

test('interleaved reclaim: B read the dead lock, A reclaims it first, B does not become owner', t => {
  const dir = tempDir(t);
  writeLock(dir, deadPid());
  let a;
  const b = owner().acquireBrowserOwner(dir, { afterRead: () => { a = owner().acquireBrowserOwner(dir); } });
  assert.equal(a.owned, true);
  assert.equal(b.owned, false);
  assert.equal(readLock(dir).token, a.token);
  assert.deepEqual(leftovers(dir), []);
});

test('interleaved reclaim: B reaches the reclaim file while A holds it and backs off', t => {
  const dir = tempDir(t);
  writeLock(dir, deadPid());
  let b;
  const a = owner().acquireBrowserOwner(dir, { afterReclaim: () => { b = owner().acquireBrowserOwner(dir); } });
  assert.equal(a.owned, true);
  assert.equal(b.owned, false);
  assert.equal(readLock(dir).token, a.token);
  assert.deepEqual(leftovers(dir), []);
});

test('a stale dead lock plus a stale reclaim file: nobody owns and both paths are shown', t => {
  const dir = tempDir(t);
  const token = writeLock(dir, deadPid());
  const reclaim = join(dir, `browser-owner.reclaim.${token}`);
  writeFileSync(reclaim, '');
  const r = owner().acquireBrowserOwner(dir);
  assert.equal(r.owned, false);
  assert.ok(r.message.includes(join(dir, LOCK)) && r.message.includes(reclaim), r.message);
  assert.equal(readLock(dir).token, token);
  assert.equal(existsSync(reclaim), true);
});

/** Starts n processes that try to own at once; each reports and stays alive until all have reported. */
async function race(dir, n) {
  const script = `const r = require(${JSON.stringify(join(DIST, 'browser-owner.js'))}).acquireBrowserOwner(process.argv[1]);
process.stdout.write(JSON.stringify({ owned: r.owned }) + '\\n'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`;
  const children = Array.from({ length: n }, () => spawn(process.execPath, ['-e', script, dir], { stdio: ['pipe', 'pipe', 'inherit'] }));
  const reports = await Promise.all(children.map(c => new Promise((resolve, reject) => {
    let out = '';
    c.stdout.on('data', d => { out += d; if (out.includes('\n')) resolve(JSON.parse(out)); });
    c.on('error', reject);
    c.on('exit', code => reject(new Error(`child exited ${code} before reporting`)));
  })));
  await Promise.all(children.map(c => new Promise(r => { c.on('exit', r); c.stdin.end(); })));
  return reports.filter(x => x.owned).length;
}

test('concurrent processes with no lock: exactly one owner', async t => {
  for (let round = 0; round < 20; round++) {
    const dir = tempDir(t);
    assert.equal(await race(dir, 8), 1, `round ${round}`);
    assert.deepEqual(leftovers(dir), [], `round ${round}`);
  }
});

test('concurrent processes reclaiming the same dead lock: exactly one owner', async t => {
  for (let round = 0; round < 20; round++) {
    const dir = tempDir(t);
    writeLock(dir, deadPid());
    assert.equal(await race(dir, 8), 1, `round ${round}`);
    assert.deepEqual(leftovers(dir), [], `round ${round}`);
  }
});

test('the bridge asks for the browser only when OMK_BRIDGE_BROWSER=1 and it owns the lock', t => {
  const { browserOption } = require(join(DIST, 'bridge.js'));
  const off = tempDir(t);
  assert.deepEqual(browserOption({}, off), {});
  assert.deepEqual(readdirSync(off), []);

  const taken = tempDir(t);
  writeLock(taken, process.ppid);
  assert.deepEqual(browserOption({ OMK_BRIDGE_BROWSER: '1' }, taken), {});

  const free = tempDir(t);
  assert.deepEqual(browserOption({ OMK_BRIDGE_BROWSER: '1' }, free), { browserProfileDir: join(free, 'browser-profile') });
  assert.equal(readLock(free).pid, process.pid);
});
