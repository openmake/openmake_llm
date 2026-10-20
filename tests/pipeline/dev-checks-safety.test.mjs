import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from '../../scripts/ci/dev-checks.mjs';
import { runCommand } from '../../scripts/ci/dev-checks-process.mjs';

test('preflight errors replace stale passing evidence before any app or DB starts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omk-stale-evidence-'));
  const output = join(directory, 'receipt.json');
  const previous = process.env.TEST_DATABASE_URL;
  try {
    await writeFile(output, JSON.stringify({ sha: 'old', status: 'passed' }));
    delete process.env.TEST_DATABASE_URL;
    await assert.rejects(main('bad-sha', { output }), /TEST_DATABASE_URL/);
    const receipt = JSON.parse(await readFile(output));
    assert.equal(receipt.sha, 'bad-sha');
    assert.equal(receipt.status, 'failed');
    assert.match(receipt.error, /TEST_DATABASE_URL/);
    process.env.TEST_DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/pipeline_test';
    await assert.rejects(main('bad-sha', { output }), /SHA/);
    assert.equal(JSON.parse(await readFile(output)).status, 'failed');
  } finally {
    if (previous === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

for (const mode of ['timeout', 'abort']) test(`${mode} kills TERM-ignoring descendant after group leader exits`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omk-descendant-'));
  const pidFile = join(directory, 'child.pid');
  const controller = new AbortController();
  // The descendant ignores TERM; its parent exits immediately on TERM.
  const childCode = `process.on('SIGTERM',()=>{});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`;
  const leaderCode = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)`;
  let pid;
  try {
    const promise = runCommand(process.execPath, ['-e', leaderCode], { timeoutMs: mode === 'timeout' ? 400 : 10000, graceMs: 100, signal: controller.signal, stdio: 'ignore' });
    const rejection = assert.rejects(promise, mode === 'timeout' ? /timed out/ : /aborted/);
    for (let i = 0; i < 100; i++) {
      try { pid = Number(await readFile(pidFile)); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    assert.ok(pid, 'descendant started');
    if (mode === 'abort') controller.abort(new Error('aborted by test'));
    await rejection;
    const status = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
    assert.ok(!status || status.startsWith('Z'), `descendant still alive: ${pid} ${status}`);
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    controller.abort();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) test(`${signal} records failure and closes a pending DB connection`, async () => {
  const { createServer } = await import('node:net');
  const { spawn, execFileSync } = await import('node:child_process');
  const { once } = await import('node:events');
  const directory = await mkdtemp(join(tmpdir(), 'omk-signal-'));
  const output = join(directory, 'receipt.json');
  const sockets = new Set();
  const server = createServer(socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const code = `import {main} from ${JSON.stringify(new URL('../../scripts/ci/dev-checks.mjs', import.meta.url).href)};main(${JSON.stringify(sha)},{output:${JSON.stringify(output)}}).catch(e=>{console.error(e.message);process.exitCode=1})`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TEST_DATABASE_URL: `postgresql://u:p@127.0.0.1:${server.address().port}/signal_test` }, stdio: 'ignore' });
  try {
    await Promise.race([once(server, 'connection'), new Promise((_, reject) => setTimeout(() => reject(new Error('No DB connection')), 2000))]);
    const exited = once(child, 'exit');
    child.kill(signal);
    const [status] = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Signal did not interrupt DB connection')), 2000))]);
    assert.equal(status, 1);
    const receipt = JSON.parse(await readFile(output));
    assert.equal(receipt.status, 'failed');
    assert.match(receipt.error, /aborted/);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('denied owned-group signal fails with bounded PID, UID and member diagnostics', async context => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const child = spawn(process.execPath, ['-e', "console.log('ready');setInterval(()=>{},1000)"], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  await once(child.stdout, 'data');
  const kill = process.kill.bind(process);
  context.mock.method(process, 'kill', (pid, signal) => {
    if (pid === -child.pid) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    return kill(pid, signal);
  });
  try {
    const { stopGroup } = await import('../../scripts/ci/dev-checks-process.mjs');
    await assert.rejects(stopGroup(child), error => error.code === 'EPERM' && error.message.includes(`pgid=${child.pid}`) && error.message.includes(`uid=${process.getuid()}`) && error.message.includes('members=['));
  } finally {
    context.mock.restoreAll();
    kill(-child.pid, 'SIGKILL');
    await once(child, 'exit');
  }
});

test('EPERM probe is absent only for a nonempty verified owned zombie-only group', async () => {
  const { handleSignalFailure } = await import('../../scripts/ci/dev-checks-process.mjs');
  const uid = process.getuid(), child = { pid: 12345, exitCode: null };
  const denied = () => Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
  const snapshot = rows => ({ status: 0, stdout: rows });
  const zombie = `12345 100 12345 ${uid} Z\n12346 1 12345 ${uid} Zs`;
  assert.equal(handleSignalFailure(denied(), child, 0, snapshot(zombie)), false);
  for (const live of [snapshot(`12345 100 12345 ${uid} S`), snapshot(`12345 100 12345 ${uid} ?Es`), snapshot(`${zombie}\n12347 100 12345 ${uid} S`), snapshot(Array.from({length: 20}, (_, i) => `${12345+i} 100 12345 ${uid} Z`).join('\n') + `\n12399 100 12345 ${uid} S`)]) assert.equal(handleSignalFailure(denied(), child, 0, live), true);
  for (const unsafe of [snapshot(''), snapshot(`12345 100 12345 ${uid + 1} Z`), snapshot(`${zombie}\n12347 100 12345 ${uid + 1} Z`), snapshot('12345 100 12345 unknown Z'), { status: 1, stdout: zombie }, {status: 0, stdout: zombie, error: new Error('snapshot truncated')}]) {
  assert.throws(() => handleSignalFailure(denied(), child, 0, unsafe), error => error.code === 'EPERM');
  }
  assert.throws(() => handleSignalFailure(denied(), child, 'SIGTERM', snapshot(zombie)), /EPERM/);
});

test('owned live EPERM probes keep polling and a denied deadline KILL still fails', async context => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { stopGroup } = await import('../../scripts/ci/dev-checks-process.mjs');
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  await once(child.stdout, 'data');
  const kill = process.kill.bind(process);
  const signals = [];
  context.mock.method(process, 'kill', (pid, signal) => {
    if (pid === -child.pid) {
      signals.push(signal);
      if (signal === 0 || signal === 'SIGKILL') throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    }
    return kill(pid, signal);
  });
  try {
    await assert.rejects(stopGroup(child, { graceMs: 100 }), error => error.code === 'EPERM' && error.message.includes('signal=SIGKILL'));
    assert.ok(signals.includes(0));
    assert.ok(signals.includes('SIGKILL'));
  } finally { context.mock.restoreAll(); kill(-child.pid, 'SIGKILL'); await once(child, 'exit'); }
});
