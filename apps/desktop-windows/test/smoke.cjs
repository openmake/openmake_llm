/**
 * 기동 검증 — 번들한 앱을 실제 Electron 으로 띄워 가짜 브리지 서버에 붙는지 본다.
 *   hello 프레임(Bearer 인증·PC 식별자·능력 목록) → bridge_ready → 연결됨 → 요청 1건 실행(파일 읽기)·폴더 밖 경로 거부 → 종료.
 * 실행: npm run smoke (사전: 저장소 루트에서 npm run build:packages, 이 폴더에서 npm install)
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WebSocketServer } = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'ws'));

(async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-desktop-smoke-')));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-desktop-data-'));
  fs.writeFileSync(path.join(folder, 'seed.txt'), 'seed');
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once('listening', r));
  const frames = [];
  const waiters = [];
  let socket = null;
  let auth = null;
  wss.on('connection', (ws, req) => {
    socket = ws;
    auth = req.headers.authorization;
    ws.on('message', (d) => {
      const f = JSON.parse(d.toString());
      frames.push(f);
      if (f.type === 'bridge_hello') ws.send(JSON.stringify({ type: 'bridge_ready', deviceId: f.deviceId }));
      for (const w of [...waiters]) if (w.pred(f)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(f); }
    });
  });
  const waitFor = (pred, ms = 20000) => new Promise((resolve, reject) => {
    const hit = frames.find(pred);
    if (hit) return resolve(hit);
    const w = { pred, resolve };
    waiters.push(w);
    setTimeout(() => reject(new Error('프레임 대기 시간 초과')), ms);
  });
  const exec = async (payload) => {
    const reqId = `smoke-${Math.random().toString(36).slice(2)}`;
    socket.send(JSON.stringify({ type: 'bridge_exec', reqId, expiresAt: Date.now() + 30000, ...payload }));
    return (await waitFor((f) => f.type === 'bridge_result' && f.reqId === reqId)).result;
  };

  const electron = require('electron'); // 실행 파일 경로
  const child = spawn(electron, [path.join(__dirname, '..')], {
    env: { ...process.env, OMK_DESKTOP_SMOKE: '1', OMK_DESKTOP_SERVER: `http://127.0.0.1:${wss.address().port}`,
      OMK_DESKTOP_API_KEY: 'omk_live_smoke', OMK_DESKTOP_FOLDER: folder, OMK_DESKTOP_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const events = [];
  child.stdout.on('data', (d) => { for (const line of d.toString().split('\n')) { try { events.push(JSON.parse(line)); } catch { /* 로그 줄 */ } } });
  let failed = null;
  try {
    const hello = await waitFor((f) => f.type === 'bridge_hello');
    assert.equal(auth, 'Bearer omk_live_smoke', 'Bearer 인증 헤더');
    assert.equal(hello.folderName, path.basename(folder), 'hello folderName');
    assert.ok(/^[a-f0-9-]{36}$/.test(hello.hostId), 'hello hostId = PC 식별자');
    assert.ok(hello.deviceId.startsWith(`${hello.hostId}-r-`), '폴더별 기기 ID 는 PC 식별자에서 파생');
    assert.ok(Array.isArray(hello.capabilities) && hello.capabilities.includes('read') && hello.capabilities.includes('exec'), 'hello 능력 목록');
    assert.ok(!hello.capabilities.includes('browser'), '설정에서 켜지 않으면 browser 를 알리지 않는다');
    const read = await exec({ kind: 'read', path: 'seed.txt' });
    assert.ok(read.ok === true && read.content === 'seed', '파일 읽기');
    const escape = await exec({ kind: 'read', path: '../../etc/hosts' });
    assert.equal(escape.ok, false, '폴더 밖 경로 거부');
    const expired = await exec({ kind: 'write', path: 'late.txt', contentB64: 'eA==', expiresAt: Date.now() - 10 * 60 * 1000 });
    assert.equal(expired.rejected, 'expired', '만료 요청 거절');
    assert.ok(!fs.existsSync(path.join(folder, 'late.txt')), '만료 요청은 실행되지 않는다');
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(events.some((e) => e.ev === 'ready'), 'ready 이벤트');
    assert.ok(events.some((e) => e.ev === 'status' && e.code === 'connected'), '연결됨 상태');
    assert.ok(fs.existsSync(path.join(dataDir, 'device-id')), 'PC 식별자를 데이터 폴더에 저장');
  } catch (e) { failed = e; }
  child.kill();
  await new Promise((r) => wss.close(r));
  fs.rmSync(folder, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  if (failed) { console.error(`FAIL — ${failed.message}`); process.exit(1); }
  console.log(`OK — 데스크톱 앱 기동 검증 통과 (frames=${frames.length}, events=${events.length})`);
  process.exit(0);
})();
