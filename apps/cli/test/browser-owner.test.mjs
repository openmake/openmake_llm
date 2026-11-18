// One browser owner per PC among CLI processes (~/.openmake/browser-owner.lock), against the built CLI
// (run `npm run build --workspace=@openmake/cli` first). Every case uses a temporary dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DIST, tempHome, fakeServer, runCli } from './fake-server.mjs';

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

test('a lock left with our own pid (pid reused after a restart) is reclaimed', t => {
  const dir = tempDir(t);
  const old = writeLock(dir, process.pid);
  const r = owner().acquireBrowserOwner(dir);
  assert.equal(r.owned, true);
  assert.notEqual(r.token, old);
  assert.deepEqual(readLock(dir), { pid: process.pid, token: r.token });
  assert.deepEqual(leftovers(dir), []);
});

test('the owner lets go between our link and our read: we take the lock instead of giving up', t => {
  const dir = tempDir(t);
  const other = owner().acquireBrowserOwner(dir);
  let released = false;
  const r = owner().acquireBrowserOwner(dir, { beforeRead: () => { if (!released) { released = true; owner().releaseBrowserOwner(dir, other.token); } } });
  assert.equal(r.owned, true, r.message);
  assert.deepEqual(readLock(dir), { pid: process.pid, token: r.token });
  assert.deepEqual(leftovers(dir), []);
});

// A fake Chrome that, when told to stop, takes a moment and then records whether the lock was still held.
// The exiting owner must keep the lock until its Chrome is gone, or a new CLI can attach to a Chrome that is being killed.
test('on exit the owner keeps the lock until the Chrome it launched has exited', { skip: process.platform === 'win32' && 'POSIX shell fake' }, async t => {
  const home = tempHome(t);
  const dir = join(home, '.openmake');
  const out = join(home, 'lock-at-chrome-exit');
  const bin = join(home, 'fake-chrome');
  writeFileSync(bin, [
    '#!/bin/sh',
    'for a in "$@"; do case "$a" in --user-data-dir=*) d="${a#--user-data-dir=}";; esac; done',
    `trap 'sleep 0.3; if [ -e "${join(dir, LOCK)}" ]; then echo held > "${out}"; else echo free > "${out}"; fi; kill $s 2>/dev/null; exit 0' TERM`,
    'printf \'1\\n/devtools/browser/x\\n\' > "$d/DevToolsActivePort"',
    'sleep 60 & s=$!',
    'wait $s',
  ].join('\n'), { mode: 0o755 });
  const core = require.resolve('@openmake/local-bridge-core', { paths: [DIST] });
  const script = `const { browserOption } = require(${JSON.stringify(join(DIST, 'bridge.js'))});
const { LocalBrowser } = require(${JSON.stringify(core)});
const o = browserOption(process.env, process.argv[1]);
if (!o.browserProfileDir) process.exit(2);
LocalBrowser.forProfile(o.browserProfileDir)
  .run({ actions: [{ type: 'wait', ms: 0 }], sitePolicy: { allow: [], deny: [] } }, { taskId: 'A', saveFile: async () => undefined })
  .then(() => process.exit(0));`;
  const child = spawn(process.execPath, ['-e', script, dir], { stdio: 'inherit', env: { ...process.env, OMK_BRIDGE_BROWSER: '1', OMK_BRIDGE_CHROME: bin } });
  const code = await new Promise(r => child.on('exit', r));
  assert.equal(code, 0);
  assert.equal(existsSync(join(dir, LOCK)), false, 'released after Chrome exited');
  const end = Date.now() + 3000;
  while (!existsSync(out) && Date.now() < end) await new Promise(r => setTimeout(r, 20));
  assert.equal(readFileSync(out, 'utf8').trim(), 'held');
});

// r5 (Astra): Ctrl+C while the launched Chrome has not yet written DevToolsActivePort. That Chrome exists already,
// so the owner must still see it gone before letting go of the lock — tracking must start right after the spawn.
test('Ctrl+C while Chrome is still starting keeps the lock until that Chrome has exited', { skip: process.platform === 'win32' && 'POSIX shell fake' }, async t => {
  const home = tempHome(t);
  const dir = join(home, '.openmake');
  const out = join(home, 'lock-at-chrome-exit');
  const pidFile = join(home, 'chrome-pid');
  const bin = join(home, 'fake-chrome');
  writeFileSync(bin, [
    '#!/bin/sh',
    `trap 'sleep 0.3; if [ -e "${join(dir, LOCK)}" ]; then echo held > "${out}"; else echo free > "${out}"; fi; kill $s 2>/dev/null; exit 0' TERM`,
    'sleep 60 & s=$!',
    `echo $$ > "${pidFile}"`, // never writes DevToolsActivePort: still starting
    'wait $s',
  ].join('\n'), { mode: 0o755 });
  const core = require.resolve('@openmake/local-bridge-core', { paths: [DIST] });
  const script = `const fs = require('fs');
const { browserOption } = require(${JSON.stringify(join(DIST, 'bridge.js'))});
const { LocalBrowser } = require(${JSON.stringify(core)});
process.on('SIGINT', () => process.exit(0)); // as index.ts
const o = browserOption(process.env, process.argv[1]);
if (!o.browserProfileDir) process.exit(2);
LocalBrowser.forProfile(o.browserProfileDir)
  .run({ actions: [{ type: 'wait', ms: 0 }], sitePolicy: { allow: [], deny: [] } }, { taskId: 'A', saveFile: async () => undefined })
  .catch(() => undefined);
const poll = setInterval(() => { if (fs.existsSync(process.argv[2])) { clearInterval(poll); process.kill(process.pid, 'SIGINT'); } }, 20);`;
  const child = spawn(process.execPath, ['-e', script, dir, pidFile], { stdio: 'inherit', env: { ...process.env, OMK_BRIDGE_BROWSER: '1', OMK_BRIDGE_CHROME: bin } });
  const code = await new Promise(r => child.on('exit', r));
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } });
  assert.equal(code, 0);
  const end = Date.now() + 3000;
  while (!existsSync(out) && Date.now() < end) await new Promise(r => setTimeout(r, 20));
  assert.equal(existsSync(out) ? readFileSync(out, 'utf8').trim() : 'not stopped', 'held', 'the starting Chrome is stopped while the lock is still held');
  assert.equal(existsSync(join(dir, LOCK)), false, 'released after Chrome exited');
});

// r3: Chrome that has not been seen to exit must not hand the profile over. The exiting owner leaves the lock
// to that Chrome's pid, so a new CLI backs off while it lives and reclaims the lock once it is gone.
test('releasing while our Chrome is still running hands the lock to that Chrome instead of freeing it', async t => {
  const dir = tempDir(t);
  const mine = owner().acquireBrowserOwner(dir);
  const chrome = spawn('sleep', ['60']);
  t.after(() => chrome.kill('SIGKILL'));
  owner().releaseBrowserOwner(dir, mine.token, chrome.pid);
  const handed = readLock(dir);
  assert.equal(handed.pid, chrome.pid);
  assert.notEqual(handed.token, mine.token);
  assert.deepEqual(leftovers(dir), []);
  const blocked = owner().acquireBrowserOwner(dir);
  assert.equal(blocked.owned, false);
  assert.ok(blocked.message.includes(`pid ${chrome.pid}`), blocked.message);
  chrome.kill('SIGKILL');
  await new Promise(r => chrome.once('exit', r));
  assert.equal(owner().acquireBrowserOwner(dir).owned, true);
});

// A fake Chrome that ignores SIGTERM: the exit wait runs out, so the host must force it down (SIGKILL) and
// see it gone before letting go of the lock — never free the lock while that Chrome is still alive.
test('on exit a Chrome that ignores SIGTERM is killed before the lock is let go', { skip: process.platform === 'win32' && 'POSIX shell fake', timeout: 30000 }, async t => {
  const home = tempHome(t);
  const dir = join(home, '.openmake');
  const pidFile = join(home, 'chrome-pid');
  const bin = join(home, 'fake-chrome');
  writeFileSync(bin, [
    '#!/bin/sh',
    'for a in "$@"; do case "$a" in --user-data-dir=*) d="${a#--user-data-dir=}";; esac; done',
    "trap '' TERM",
    `echo $$ > "${pidFile}"`,
    'printf \'1\\n/devtools/browser/x\\n\' > "$d/DevToolsActivePort"',
    'exec sleep 60',
  ].join('\n'), { mode: 0o755 });
  const core = require.resolve('@openmake/local-bridge-core', { paths: [DIST] });
  const script = `const { browserOption } = require(${JSON.stringify(join(DIST, 'bridge.js'))});
const { LocalBrowser } = require(${JSON.stringify(core)});
const o = browserOption(process.env, process.argv[1]);
if (!o.browserProfileDir) process.exit(2);
LocalBrowser.forProfile(o.browserProfileDir)
  .run({ actions: [{ type: 'wait', ms: 0 }], sitePolicy: { allow: [], deny: [] } }, { taskId: 'A', saveFile: async () => undefined })
  .then(() => process.exit(0), () => process.exit(0));`;
  const child = spawn(process.execPath, ['-e', script, dir], { stdio: 'inherit', env: { ...process.env, OMK_BRIDGE_BROWSER: '1', OMK_BRIDGE_CHROME: bin } });
  const code = await new Promise(r => child.on('exit', r));
  assert.equal(code, 0);
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } });
  const lockLeft = existsSync(join(dir, LOCK));
  let chromeAlive = true;
  try { process.kill(pid, 0); } catch { chromeAlive = false; }
  // Either Chrome is gone and the lock is free, or the lock still points at the living Chrome — never free while it lives.
  if (chromeAlive) assert.equal(readLock(dir).pid, pid, 'lock must stay with the still-running Chrome');
  else assert.equal(lockLeft, false, 'released after Chrome was killed');
  assert.equal(chromeAlive, false, 'a Chrome ignoring SIGTERM is force-killed on exit');
});

// r4 (Fable): handing the lock to a lingering Chrome must not keep the old token. Otherwise a reclaimer that read
// {deadOwner, T} before the hand-over passes its token re-check and takes the lock while that Chrome still lives.
test('a reclaimer that read the lock before it was handed to a lingering Chrome backs off', async t => {
  const dir = tempDir(t);
  const token = writeLock(dir, deadPid());
  const chrome = spawn('sleep', ['60']);
  t.after(() => chrome.kill('SIGKILL'));
  const r = owner().acquireBrowserOwner(dir, { afterRead: () => owner().releaseBrowserOwner(dir, token, chrome.pid) });
  assert.equal(r.owned, false);
  const lock = readLock(dir);
  assert.equal(lock.pid, chrome.pid);
  assert.notEqual(lock.token, token);
  assert.deepEqual(leftovers(dir), []);
});

// r4 (Fable): what the server sees — a CLI that is not the browser owner leaves 'browser' out of bridge_hello.
test('bridge_hello lists the browser only for the CLI that owns the lock', async t => {
  const hello = async lockPid => {
    const server = await fakeServer(t, (method, url) => {
      if (method === 'POST' && url === '/api/agent-tasks/task-b/resume') return { message: 'ok' };
      if (url === '/api/agent-tasks/task-b') return { task: { id: 'task-b', executor: 'local', device_id: null, status: server?.hellos?.length ? 'completed' : 'failed' } };
      return undefined;
    });
    const home = tempHome(t, { serverUrl: server.url, hostId: '11111111-2222-4333-8444-555555555555' });
    if (lockPid) writeLock(join(home, '.openmake'), lockPid);
    // findChrome only checks that the path exists; nothing launches Chrome here.
    const { code, out, err } = await runCli(home, ['resume', 'task-b', '--dir', home], { env: { OMK_BRIDGE_BROWSER: '1', OMK_BRIDGE_CHROME: process.execPath } });
    assert.equal(code, 0, `${out}\n${err}`);
    assert.equal(server.hellos.length, 1);
    return server.hellos[0].capabilities;
  };
  assert.ok((await hello(undefined)).includes('browser'), 'the owner announces the browser');
  assert.ok(!(await hello(process.pid)).includes('browser'), 'a CLI that lost the lock must not announce the browser');
});
