// Per-folder deviceId against the built CLI (run `npm run build --workspace=@openmake/cli` first).
// deviceId = <~/.openmake/device-id>-r-<sha256(folder realpath) first 12>, hostId = the file value — the
// Companion rule. The connection and every command that names the device must use the same folder id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DIST, tempHome, fakeServer, runCli } from './fake-server.mjs';

const HOST = '11111111-2222-4333-8444-555555555555';
const expected = folder => `${HOST}-r-${createHash('sha256').update(realpathSync(folder)).digest('hex').slice(0, 12)}`;

function tempFolder(t) {
  const dir = mkdtempSync(join(tmpdir(), 'omk-cli-folder-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function deviceIdForInChild(home, folder) {
  const r = spawnSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(join(DIST, 'config.js'))}).deviceIdFor(process.argv[1]))`, folder], { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('deviceId differs per folder, shares the hostId, and is stable across runs and symlinks', t => {
  const home = tempHome(t, { hostId: HOST });
  const a = tempFolder(t);
  const b = tempFolder(t);
  const link = join(tempFolder(t), 'link-to-a');
  symlinkSync(a, link);
  const idA = deviceIdForInChild(home, a);
  assert.equal(idA, expected(a));
  assert.equal(deviceIdForInChild(home, a), idA);
  assert.equal(deviceIdForInChild(home, link), idA);
  assert.notEqual(deviceIdForInChild(home, b), idA);
  assert.ok(deviceIdForInChild(home, b).startsWith(`${HOST}-r-`));
});

test('run connects, registers and creates the task with the folder id and sends hostId', async t => {
  const server = await fakeServer(t);
  const home = tempHome(t, { serverUrl: server.url, hostId: HOST });
  const folder = tempFolder(t);
  const { code, out, err } = await runCli(home, ['목표', '--dir', folder]);
  assert.equal(code, 0, `${out}\n${err}`);
  assert.equal(server.hellos.length, 1);
  assert.equal(server.hellos[0].deviceId, expected(folder));
  assert.equal(server.hellos[0].hostId, HOST);
  const created = server.requests.find(r => r.method === 'POST' && r.url === '/api/agent-tasks');
  assert.equal(created.body.deviceId, expected(folder));
});

test('tasks lists the tasks of the --dir folder id', async t => {
  const server = await fakeServer(t);
  const home = tempHome(t, { serverUrl: server.url, hostId: HOST });
  const folder = tempFolder(t);
  const { code, out } = await runCli(home, ['tasks', '--dir', folder]);
  assert.equal(code, 0);
  const listed = server.requests.find(r => r.url.startsWith('/api/agent-tasks?'));
  assert.equal(new URL(listed.url, server.url).searchParams.get('deviceId'), expected(folder));
  assert.match(out, new RegExp(realpathSync(folder).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('tasks without --dir uses the current folder', async t => {
  const server = await fakeServer(t);
  const home = tempHome(t, { serverUrl: server.url, hostId: HOST });
  const folder = tempFolder(t);
  const { code } = await runCli(home, ['tasks'], { cwd: folder });
  assert.equal(code, 0);
  const listed = server.requests.find(r => r.url.startsWith('/api/agent-tasks?'));
  assert.equal(new URL(listed.url, server.url).searchParams.get('deviceId'), expected(folder));
});

test('--resume picks its target from the --dir folder id', async t => {
  const server = await fakeServer(t);
  const home = tempHome(t, { serverUrl: server.url, hostId: HOST });
  const folder = tempFolder(t);
  const { code } = await runCli(home, ['--resume', '--dir', folder]);
  assert.equal(code, 1);
  const listed = server.requests.find(r => r.url.startsWith('/api/agent-tasks?'));
  assert.equal(new URL(listed.url, server.url).searchParams.get('deviceId'), expected(folder));
});

test('resume accepts a task of the folder id and connects with that id', async t => {
  let resumed = false;
  const folder = tempFolder(t);
  const server = await fakeServer(t, (method, url) => {
    if (method === 'POST' && url === '/api/agent-tasks/task-r/resume') { resumed = true; return { message: 'ok' }; }
    if (url === '/api/agent-tasks/task-r') return { task: { id: 'task-r', executor: 'local', device_id: expected(folder), status: resumed ? 'completed' : 'failed' } };
    return undefined;
  });
  const home = tempHome(t, { serverUrl: server.url, hostId: HOST });
  const { code, out, err } = await runCli(home, ['resume', 'task-r', '--dir', folder]);
  assert.equal(code, 0, `${out}\n${err}`);
  assert.equal(resumed, true);
  assert.equal(server.hellos[0].deviceId, expected(folder));
});

test('resume refuses a task made with the old host-only id', async t => {
  const folder = tempFolder(t);
  const server = await fakeServer(t, (_method, url) => (url === '/api/agent-tasks/task-old' ? { task: { id: 'task-old', executor: 'local', device_id: HOST, status: 'failed' } } : undefined));
  const home = tempHome(t, { serverUrl: server.url, hostId: HOST });
  const { code, err } = await runCli(home, ['resume', 'task-old', '--dir', folder]);
  assert.equal(code, 1);
  assert.match(err, /다른 디바이스/);
  assert.equal(server.hellos.length, 0);
});

test('status shows the hostId and the current folder id', async t => {
  const server = await fakeServer(t);
  const home = tempHome(t, { serverUrl: server.url, hostId: HOST });
  const folder = tempFolder(t);
  const { code, out } = await runCli(home, ['status'], { cwd: folder });
  assert.equal(code, 0);
  assert.ok(out.includes(HOST), out);
  assert.ok(out.includes(expected(folder)), out);
});
