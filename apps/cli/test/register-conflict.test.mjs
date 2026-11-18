// CLI 등록 확인 (설계 2026-11-19 device-id-conflict §3.2 r4) — run·resume 은 자기 소켓이 bridge_ready 를 받았을 때만 작업을 만든다.
// 서버 기기 목록에 같은 deviceId 가 있어도(다른 프로세스의 연결) 성공으로 보지 않는다.
// 빌드된 CLI(`npm run build --workspace=@openmake/cli`)를 임시 HOME 으로 띄우고, HTTP·WebSocket 한 포트의 가짜 서버에 붙인다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const DEVICE_ID = 'cli-test-device-1';
const TASK_ID = 'task-1234abcd';

/**
 * 가짜 서버. hello 응답: ready(bridge_ready) · conflict(error + 1008 device_conflict) · silent(무응답) ·
 * auth(1008 api_key_revoked) · limit(error + 1008 bridge_device_limit).
 */
async function fakeServer({ hello, enabled = true, devices = [{ deviceId: DEVICE_ID, label: 'other', folderName: 'w' }], task }) {
  const requests = [];
  let wsConnections = 0;
  let created = false;
  const http = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url });
      const json = (data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data })); };
      const url = req.url ?? '';
      if (url === '/api/local-bridge/status') return json({ enabled, connected: devices.length > 0, devices });
      if (req.method === 'POST' && url === '/api/agent-tasks') { created = true; return json({ task: { id: TASK_ID, status: 'pending' } }); }
      if (url === '/api/agent-tasks/approvals/pending') return json({ pending: [] });
      if (req.method === 'GET' && url === `/api/agent-tasks/${TASK_ID}`) return json({ task: created ? { id: TASK_ID, status: 'completed', result: 'done' } : task });
      return json({});
    });
  });
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (ws) => {
    wsConnections += 1;
    ws.on('message', (d) => {
      const f = JSON.parse(d.toString());
      if (f.type !== 'bridge_hello') return;
      if (hello === 'ready') ws.send(JSON.stringify({ type: 'bridge_ready', deviceId: f.deviceId }));
      else if (hello === 'conflict') {
        ws.send(JSON.stringify({ type: 'error', message: '같은 기기 id 로 다른 앱이 이미 연결돼 있습니다' }));
        ws.close(1008, 'device_conflict');
      } else if (hello === 'auth') ws.close(1008, 'api_key_revoked');
      else if (hello === 'limit') {
        ws.send(JSON.stringify({ type: 'error', message: '브리지 디바이스 상한(3대)을 초과했습니다' }));
        ws.close(1008, 'bridge_device_limit');
      }
    });
  });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const { port } = http.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    wsConnections: () => wsConnections,
    posts: (re) => requests.filter((r) => r.method === 'POST' && re.test(r.url ?? '')),
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(); http.close(() => r()); }),
  };
}

function home(serverUrl) {
  const h = mkdtempSync(join(tmpdir(), 'omk-cli-reg-'));
  mkdirSync(join(h, '.openmake'), { recursive: true });
  writeFileSync(join(h, '.openmake/config.json'), JSON.stringify({ serverUrl, apiKey: 'omk_live_fixture' }));
  writeFileSync(join(h, '.openmake/device-id'), DEVICE_ID);
  mkdirSync(join(h, 'work'));
  return h;
}

function cli(h, args, limitMs = 30000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [CLI, ...args], { cwd: join(h, 'work'), env: { PATH: process.env.PATH, HOME: h }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (c) => { out += c; });
    child.stderr.setEncoding('utf8').on('data', (c) => { out += c; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`CLI timed out: ${out}`)); }, limitMs);
    child.on('error', reject);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, ms: Date.now() - started }); });
  });
}

async function scenario(t, opts) {
  assert.ok(existsSync(CLI), 'build the CLI first');
  const server = await fakeServer(opts);
  const h = home(server.url);
  t.after(async () => { await server.close(); rmSync(h, { recursive: true, force: true }); });
  return { server, h };
}

const TASK_WRITES = /^\/api\/agent-tasks(\/|$)/;

test('① 충돌로 거절되면 run 은 목록에 같은 id 가 있어도 작업을 만들지 않고 1 로 끝난다', async (t) => {
  const { server, h } = await scenario(t, { hello: 'conflict' });
  const r = await cli(h, ['파일 하나 만들기', '--dir', '.']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /다른 OpenMake Companion·CLI 가 이미 연결돼 있어 작업을 시작하지 않았습니다/);
  assert.deepEqual(server.posts(TASK_WRITES), []);
});

test('② 충돌로 거절되면 resume 은 재개·승인 자동화를 부르지 않는다(실패 작업)', async (t) => {
  const task = { id: TASK_ID, executor: 'local', device_id: DEVICE_ID, status: 'failed', resumable: true };
  const { server, h } = await scenario(t, { hello: 'conflict', task });
  const r = await cli(h, ['resume', TASK_ID, '--dir', '.']);
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(server.posts(TASK_WRITES), []);
});

test('② 진행 중 작업이어도 충돌이면 따라가지 않고 끝난다', async (t) => {
  const task = { id: TASK_ID, executor: 'local', device_id: DEVICE_ID, status: 'running' };
  const { server, h } = await scenario(t, { hello: 'conflict', task });
  const r = await cli(h, ['resume', TASK_ID, '--dir', '.']);
  assert.equal(r.code, 1, r.out);
  assert.doesNotMatch(r.out, /진행을 따라갑니다/);
  assert.deepEqual(server.requests.filter((q) => q.url === '/api/agent-tasks/approvals/pending'), []);
  assert.deepEqual(server.posts(TASK_WRITES), []);
});

test('③ 목록이 아니라 자기 소켓 — bridge_ready 를 받으면 목록이 비어 있어도 작업을 만든다', async (t) => {
  const { server, h } = await scenario(t, { hello: 'ready', devices: [] });
  const r = await cli(h, ['파일 하나 만들기', '--dir', '.']);
  assert.equal(r.code, 0, r.out);
  assert.equal(server.posts(/^\/api\/agent-tasks$/).length, 1);
  assert.equal(server.posts(/\/execute$/).length, 1);
});

test('④ hello 에 답이 없으면 대기 시간 뒤 1 로 끝나고 작업을 만들지 않는다(목록에 같은 id 가 있어도)', async (t) => {
  const { server, h } = await scenario(t, { hello: 'silent' });
  const r = await cli(h, ['파일 하나 만들기', '--dir', '.']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /브리지 연결에 실패했습니다/);
  assert.ok(r.ms >= 15000, `waited ${r.ms}ms`);
  assert.deepEqual(server.posts(TASK_WRITES), []);
});

test('⑤ 인증 사유로 닫히면 대기 시간을 다 쓰지 않고 그 사유 문구로 끝난다', async (t) => {
  const { server, h } = await scenario(t, { hello: 'auth' });
  const r = await cli(h, ['파일 하나 만들기', '--dir', '.']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /API key 가 폐기되었습니다/);
  assert.ok(r.ms < 10000, `took ${r.ms}ms`);
  assert.deepEqual(server.posts(TASK_WRITES), []);
});

test('⑥ 기기 상한이면 실패 문구에 서버 오류 문구가 붙는다', async (t) => {
  const { server, h } = await scenario(t, { hello: 'limit' });
  const r = await cli(h, ['파일 하나 만들기', '--dir', '.']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /브리지 연결에 실패했습니다.*디바이스 상한\(3대\)을 초과했습니다/);
  assert.deepEqual(server.posts(TASK_WRITES), []);
});

test('⑦ 기능이 꺼져 있으면 연결을 시도하지 않고 종전 문구로 끝난다', async (t) => {
  const { server, h } = await scenario(t, { hello: 'ready', enabled: false });
  const r = await cli(h, ['파일 하나 만들기', '--dir', '.']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /서버에서 로컬 실행 기능이 비활성화되어 있습니다/);
  assert.equal(server.wsConnections(), 0);
  assert.deepEqual(server.posts(TASK_WRITES), []);
});

test('⑧ --dir 없이 준 목표도 목표로 읽는다(첫 인자를 버리지 않는다)', async (t) => {
  const { server, h } = await scenario(t, { hello: 'ready', devices: [] });
  const r = await cli(h, ['파일 하나 만들기']);
  assert.equal(r.code, 0, r.out);
  assert.equal(server.posts(/^\/api\/agent-tasks$/).length, 1);
});
