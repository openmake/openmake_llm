/**
 * Companion 헬퍼 헤드리스 하네스 — helper.cjs 를 실프로세스로 spawn 해 회귀 검증.
 *
 * 데스크톱 하네스(apps/desktop/bridge-harness.cjs)와 동일 축이되 호스트 차이를 검증한다:
 *  - 인증: Authorization Bearer(API key) 헤더, Origin 없음 (CLI 계약과 동일)
 *  - confirmExec: 자동승인 훅이 아니라 **실제 stdio 왕복** — 승인(yes)/거부(no) 양쪽
 *  - browser: 어댑터 미주입 → 코어 미지원 거부
 *  - 다중 루트(0.2.0): 루트당 독립 연결·파생 deviceId·스코프 상호 격리·개별 해제
 *  - stdin 종료 = 즉시 정리 종료 (좀비 방지)
 *
 * 실행: node apps/desktop-native/helper/harness.cjs
 *      (사전: npm run build:packages + esbuild 번들 — build.sh 참조)
 * 종료코드 0 = 전 케이스 통과.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { WebSocketServer } = require('ws');

(async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-cpharness-'));
    const git = (args) => execFileSync('git', args, { cwd: folder, encoding: 'utf8' });
    git(['init', '-q']);
    git(['-c', 'user.email=h@h', '-c', 'user.name=h', 'commit', '--allow-empty', '-q', '-m', 'init']);
    fs.writeFileSync(path.join(folder, 'seed.txt'), 'seed');
    fs.mkdirSync(path.join(folder, 'subdir'));
    // 두 번째 루트 (git 아님) — 다중 루트 검증용
    const folder2 = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-cpharness2-'));
    fs.writeFileSync(path.join(folder2, 'other.txt'), 'other-root');

    // 가짜 브리지 서버 — deviceId 별 소켓 추적 (다중 루트 = 다중 연결)
    const received = [];       // {frame, deviceId}
    const waiters = [];
    const socks = new Map();   // deviceId -> ws
    const hellos = [];         // {frame, headers}
    const wss = new WebSocketServer({ port: 0 });
    await new Promise((r) => wss.once('listening', r));
    const port = wss.address().port;
    wss.on('connection', (ws, req) => {
        let myDeviceId = null;
        ws.on('message', (d) => {
            const f = JSON.parse(d.toString());
            if (f.type === 'bridge_hello') {
                myDeviceId = f.deviceId;
                socks.set(myDeviceId, ws);
                hellos.push({ frame: f, headers: req.headers });
                ws.send(JSON.stringify({ type: 'bridge_ready', deviceId: myDeviceId }));
            }
            received.push({ frame: f, deviceId: myDeviceId });
            for (let i = waiters.length - 1; i >= 0; i--) {
                if (waiters[i].pred(f, myDeviceId)) { waiters[i].resolve(f); waiters.splice(i, 1); }
            }
        });
        ws.on('close', () => { if (myDeviceId && socks.get(myDeviceId) === ws) socks.delete(myDeviceId); });
    });
    const waitFor = (pred, ms = 8000) => {
        const hit = received.find((r) => pred(r.frame, r.deviceId));
        if (hit) return Promise.resolve(hit.frame);
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('frame timeout: ' + received.map((r) => r.frame.type).join(','))), ms);
            waiters.push({ pred, resolve: (f) => { clearTimeout(t); resolve(f); } });
        });
    };
    const execVia = (deviceId, m) => {
        const reqId = 'h-' + Math.random().toString(36).slice(2, 8);
        socks.get(deviceId).send(JSON.stringify({ type: 'bridge_exec', reqId, ...m }));
        return waitFor((f) => f.type === 'bridge_result' && f.reqId === reqId).then((f) => f.result);
    };

    // 헬퍼 spawn — API key 는 env(ps 인자 비노출 계약)
    const helper = spawn(process.execPath, [
        path.join(__dirname, 'dist/helper.cjs'), '--server', `http://127.0.0.1:${port}`,
    ], { env: { ...process.env, OMK_COMPANION_API_KEY: 'omk_live_harness' }, stdio: ['pipe', 'pipe', 'inherit'] });
    const events = [];
    const evWaiters = [];
    let buf = '';
    helper.stdout.on('data', (d) => {
        buf += d.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            const ev = JSON.parse(line);
            events.push(ev);
            for (let i = evWaiters.length - 1; i >= 0; i--) {
                if (evWaiters[i].pred(ev)) { evWaiters[i].resolve(ev); evWaiters.splice(i, 1); }
            }
        }
    });
    const waitEv = (pred, ms = 8000) => {
        const hit = events.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('event timeout: ' + events.map((e) => e.ev).join(','))), ms);
            evWaiters.push({ pred, resolve: (e) => { clearTimeout(t); resolve(e); } });
        });
    };
    const send = (obj) => helper.stdin.write(JSON.stringify(obj) + '\n');
    const realFolder = fs.realpathSync(folder);
    const realFolder2 = fs.realpathSync(folder2);

    // ① connect → hello: Bearer 인증, Origin 없음, 디바이스 메타
    send({ cmd: 'connect', folder });
    const hello = await waitFor((f) => f.type === 'bridge_hello');
    assert.equal(hello.folderName, path.basename(folder), 'hello folderName');
    assert.equal(hellos[0].headers.authorization, 'Bearer omk_live_harness', 'Bearer 인증 헤더');
    assert.ok(!hellos[0].headers.origin, 'Origin 헤더 없음 (네이티브 클라이언트)');
    const dev1 = hello.deviceId;
    await waitEv((e) => e.ev === 'connected' && e.folder === realFolder);

    // ② 파일 kind 왕복 + 스코프
    assert.equal((await execVia(dev1, { kind: 'read', path: 'seed.txt' })).content, 'seed', 'read');
    await execVia(dev1, { kind: 'write', path: 'subdir/out.txt', contentB64: Buffer.from('written').toString('base64') });
    assert.equal(fs.readFileSync(path.join(folder, 'subdir/out.txt'), 'utf8'), 'written', 'write');
    assert.equal((await execVia(dev1, { kind: 'read', path: '../../etc/hosts' })).ok, false, '스코프 탈출 거부');
    const all = await execVia(dev1, { kind: 'listAll' });
    assert.ok(all.entries.includes('seed.txt') && all.entries.includes('subdir/out.txt'), 'listAll');

    // ③ exec — denylist / stdio confirm 승인 / 거부
    assert.equal((await execVia(dev1, { kind: 'exec', command: 'sudo ls' })).exitCode, 126, 'denylist 126');
    const runP = execVia(dev1, { kind: 'exec', command: 'echo -n from-companion', taskId: 'harness-task-000000000001' });
    const c1 = await waitEv((e) => e.ev === 'confirm');
    assert.ok(c1.command.includes('from-companion') && c1.sandbox === true, 'confirm 이벤트 내용');
    assert.equal(c1.folder, realFolder, 'confirm 이벤트 루트 표기');
    send({ cmd: 'confirm', id: c1.id, result: 'yes' });
    const ran = await runP;
    assert.deepEqual([ran.ok, ran.stdout], [true, 'from-companion'], 'confirm yes → 실행');
    const denyP = execVia(dev1, { kind: 'exec', command: 'echo denied-cmd' });
    const c2 = await waitEv((e) => e.ev === 'confirm' && e.id !== c1.id);
    send({ cmd: 'confirm', id: c2.id, result: 'no' });
    const deniedR = await denyP;
    assert.deepEqual([deniedR.ok, deniedR.exitCode], [false, 126], 'confirm no → 거부');

    // ③-B 일괄 승인('all') — 같은 작업 내 재확인 없음 + task_end 회수
    const allP = execVia(dev1, { kind: 'exec', command: 'echo -n bulk-1', taskId: 'harness-task-000000000002' });
    const c3 = await waitEv((e) => e.ev === 'confirm' && e.id > c2.id);
    send({ cmd: 'confirm', id: c3.id, result: 'all' });
    assert.equal((await allP).stdout, 'bulk-1', 'all 승인 실행');
    await waitEv((e) => e.ev === 'autoApprove' && e.count === 1);
    const confirmsBefore = events.filter((e) => e.ev === 'confirm').length;
    assert.equal((await execVia(dev1, { kind: 'exec', command: 'echo -n bulk-2', taskId: 'harness-task-000000000002' })).stdout, 'bulk-2', 'all 후 재확인 없이 실행');
    assert.equal(events.filter((e) => e.ev === 'confirm').length, confirmsBefore, 'all 승인 중 confirm 미발생');
    await execVia(dev1, { kind: 'task_end', taskId: 'harness-task-000000000002' });
    await waitEv((e) => e.ev === 'taskEnd');
    await waitEv((e) => e.ev === 'autoApprove' && e.count === 0);

    // ④ folders 열거 / browser 미지원 / worktree
    assert.deepEqual((await execVia(dev1, { kind: 'folders', path: '.' })).entries, ['subdir'], 'folders 열거');
    assert.equal((await execVia(dev1, { kind: 'browser', spec: {} })).ok, false, 'browser 미지원 거부');
    const taskId = 'harness-task-000000000003';
    const wt = await execVia(dev1, { kind: 'worktree', op: 'add', taskId });
    assert.ok(wt.ok && wt.worktreeRel.endsWith(taskId), 'worktree add');
    fs.writeFileSync(path.join(folder, wt.worktreeRel, 'change.txt'), 'diff-me');
    const diff = await execVia(dev1, { kind: 'worktree', op: 'diff', taskId });
    assert.ok(diff.ok && diff.stdout.includes('diff-me'), 'worktree diff');

    // ⑤ 다중 루트 — 두 번째 루트 연결: 파생 deviceId 상이, 루트별 스코프 격리, 개별 해제
    send({ cmd: 'connect', folder: folder2 });
    const hello2 = await waitFor((f) => f.type === 'bridge_hello' && f.folderName === path.basename(folder2));
    const dev2 = hello2.deviceId;
    assert.notEqual(dev2, dev1, '루트별 파생 deviceId 상이');
    assert.ok(dev1.length <= 64 && dev2.length <= 64, 'deviceId 64자 상한');
    assert.ok(dev1.split('-r-')[0] === dev2.split('-r-')[0], '기기 base id 공유');
    await waitEv((e) => e.ev === 'connected' && e.folder === realFolder2);
    assert.equal((await execVia(dev2, { kind: 'read', path: 'other.txt' })).content, 'other-root', '루트2 read');
    // 루트 간 상호 격리 — 루트2 연결이 루트1 파일에 닿지 못한다
    assert.equal((await execVia(dev2, { kind: 'read', path: '../' + path.basename(folder) + '/seed.txt' })).ok, false, '루트 간 스코프 격리');
    // 루트2 confirm 이벤트는 루트2 base 를 표기한다
    const runP2 = execVia(dev2, { kind: 'exec', command: 'echo -n in-root2' });
    const c4 = await waitEv((e) => e.ev === 'confirm' && e.command.includes('in-root2'));
    assert.equal(c4.folder, realFolder2, '루트2 confirm 루트 표기');
    send({ cmd: 'confirm', id: c4.id, result: 'yes' });
    assert.equal((await runP2).stdout, 'in-root2', '루트2 exec');
    // 루트1 개별 해제 — 루트2 는 유지
    send({ cmd: 'disconnect', folder });
    await waitEv((e) => e.ev === 'disconnected' && e.folder === realFolder);
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!socks.has(dev1), '루트1 소켓 종료');
    assert.equal((await execVia(dev2, { kind: 'read', path: 'other.txt' })).content, 'other-root', '루트1 해제 후 루트2 생존');

    // ⑥ stdin 종료 = 정리 종료 (좀비 방지) — pending confirm 은 'no' 로 해소
    const zombieP = execVia(dev2, { kind: 'exec', command: 'echo never-runs' });
    await waitEv((e) => e.ev === 'confirm' && e.command.includes('never-runs'));
    helper.stdin.end();
    const code = await new Promise((r) => helper.on('exit', r));
    assert.equal(code, 0, 'stdin 종료 → exit 0');
    const zombieR = await zombieP;
    assert.deepEqual([zombieR.ok, zombieR.exitCode], [false, 126], '종료 시 pending confirm 거부 해소');

    wss.close();
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(folder2, { recursive: true, force: true });
    console.log('OK — Companion 헬퍼 하네스 전 케이스 통과 (frames=%d, events=%d, roots=2)', received.length, events.length);
    process.exit(0);
})().catch((e) => { console.error('HARNESS FAIL:', e.message); process.exit(1); });
