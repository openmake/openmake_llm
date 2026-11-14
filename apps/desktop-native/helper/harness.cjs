/**
 * Companion 헬퍼 헤드리스 하네스 — helper.cjs 를 실프로세스로 spawn 해 회귀 검증.
 *
 * CLI 브리지와 같은 코어를 쓰되 네이티브 앱 호스트 차이를 검증한다:
 *  - 인증: Authorization Bearer(API key) 헤더, Origin 없음 (CLI 계약과 동일)
 *  - confirmExec: 자동승인 훅이 아니라 **실제 stdio 왕복** — 승인(yes)/거부(no) 양쪽
 *  - browser: 앱 설정으로 켜지 않으면 능력 목록에 없고 요청을 거절한다. 제어권·중지 명령 왕복
 *  - 다중 루트(0.2.0): 루트당 독립 연결·파생 deviceId·스코프 상호 격리·개별 해제
 *  - stdin 종료 = 즉시 정리 종료 (좀비 방지)
 *
 * 실행: node apps/desktop-native/helper/harness.cjs                       — Node 헬퍼(dist/helper.cjs)
 *      (사전: npm run build:packages + esbuild 번들 — build.sh 참조)
 *      node apps/desktop-native/helper/harness.cjs --helper <실행 파일>     — 그 실행 파일(예: omk-helper)을 직접 띄운다
 * 두 헬퍼가 같은 단언을 통과해야 한다 — 헬퍼별 분기는 띄우는 방법(spawnHelper) 한 곳뿐이다.
 * 종료코드 0 = 전 케이스 통과.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { WebSocketServer } = require('ws');

// --helper <실행 파일>: 그 실행 파일을 같은 인자(--server …)로 띄운다. 없으면 Node 헬퍼 번들.
const HELPER_BIN = (() => {
    const i = process.argv.indexOf('--helper');
    return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null;
})();
const HELPER_NAME = HELPER_BIN ? path.basename(HELPER_BIN) : 'helper.cjs(Node)';

/** 헬퍼 stdout 의 이벤트를 모은다 — 조건 대기(이미 있으면 바로)·n번째 이후 대기·stdin 명령. */
function track(child) {
    const events = [];
    const evWaiters = [];
    let buf = '';
    child.stdout.setEncoding('utf8'); // 조각을 이어 디코드한다 — 조각마다 문자열로 바꾸면 경계의 다바이트 글자가 깨진다
    child.stdout.on('data', (d) => {
        buf += d;
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
    const waitEvAfter = (n, pred, ms) => waitEv((e) => events.indexOf(e) >= n && pred(e), ms);
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
    return { events, waitEv, waitEvAfter, send };
}

/** 끝날 때까지(stdio 가 닫힐 때까지) — [code, signal]. 한도를 넘으면 실패. */
function exitOf(child, ms = 8000) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve([child.exitCode, child.signalCode]);
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('helper exit timeout')), ms);
        child.once('close', (code, signal) => { clearTimeout(t); resolve([code, signal]); });
    });
}

/** 헬퍼를 띄우는 곳은 여기 하나. API key 는 argv·env 가 아니라 stdin 의 auth 명령으로 준다. */
function spawnHelper(args, opts = {}) {
    const env = { ...process.env, ...(opts.env || {}) };
    delete env.OMK_COMPANION_API_KEY;
    const [cmd, argv] = HELPER_BIN
        ? [HELPER_BIN, args]
        : [process.execPath, [path.join(__dirname, 'dist/helper.cjs'), ...args]];
    return spawn(cmd, argv, { env, stdio: opts.stdio || ['pipe', 'pipe', 'inherit'] });
}

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
    const waitForAfter = (n, pred, ms) => waitFor((f, d) => received.findIndex((r) => r.frame === f) >= n && pred(f, d), ms);
    const serverUrl = `http://127.0.0.1:${port}`;
    const execVia = (deviceId, m) => {
        const reqId = 'h-' + Math.random().toString(36).slice(2, 8);
        socks.get(deviceId).send(JSON.stringify({ type: 'bridge_exec', reqId, ...m }));
        return waitFor((f) => f.type === 'bridge_result' && f.reqId === reqId).then((f) => f.result);
    };

    // 헬퍼 spawn — API key 는 argv·env 가 아니라 stdin 의 auth 명령으로 준다(시작 인자·환경은 다른 프로세스가 읽을 수 있다)
    const helper = spawnHelper(['--server', `http://127.0.0.1:${port}`]);
    const { events, waitEv, waitEvAfter, send } = track(helper);
    const realFolder = fs.realpathSync(folder);
    const realFolder2 = fs.realpathSync(folder2);

    // ① auth(stdin) → connect → hello: Bearer 인증, Origin 없음, 디바이스 메타
    send({ cmd: 'auth', apiKey: 'omk_live_harness' });
    send({ cmd: 'connect', folder });
    const hello = await waitFor((f) => f.type === 'bridge_hello');
    assert.equal(hello.folderName, path.basename(folder), 'hello folderName');
    assert.equal(hellos[0].headers.authorization, 'Bearer omk_live_harness', 'Bearer 인증 헤더');
    assert.ok(!hellos[0].headers.origin, 'Origin 헤더 없음 (네이티브 클라이언트)');
    const dev1 = hello.deviceId;
    await waitEv((e) => e.ev === 'connected' && e.folder === realFolder);
    // H1 기동 첫 줄 · H2 endpoints — 가짜 서버는 HTTP 조회에 답하지 않으므로(426) 넣은 주소 그대로, 한 번
    assert.deepEqual(events[0], { ev: 'status', text: '미연결', code: 'idle' }, 'H1 첫 이벤트 status idle');
    const eps = events.filter((e) => e.ev === 'endpoints');
    assert.deepEqual(eps, [{ ev: 'endpoints', bridgeUrl: serverUrl, webUrl: serverUrl, discovered: false }], 'H2 endpoints 한 번');

    // ② 파일 kind 왕복 + 스코프
    assert.equal((await execVia(dev1, { kind: 'read', path: 'seed.txt' })).content, 'seed', 'read');
    await execVia(dev1, { kind: 'write', path: 'subdir/out.txt', contentB64: Buffer.from('written').toString('base64') });
    assert.equal(fs.readFileSync(path.join(folder, 'subdir/out.txt'), 'utf8'), 'written', 'write');
    assert.equal((await execVia(dev1, { kind: 'read', path: '../../etc/hosts' })).ok, false, '스코프 탈출 거부');
    const all = await execVia(dev1, { kind: 'listAll' });
    assert.ok(all.entries.includes('seed.txt') && all.entries.includes('subdir/out.txt'), 'listAll');

    // ②-B 서버 단방향 알림(bridge_notice) — 검증 통과분만 approvalPending 이벤트로, 응답 프레임 없음.
    //      상태 이벤트엔 다국어 표시용 code·arg 가 실린다(앱이 코드로 번역).
    assert.ok(events.some((e) => e.ev === 'status' && e.folder === realFolder && e.code === 'connected'
        && e.arg === path.basename(realFolder)), 'status code=connected · arg=폴더명');
    const framesBefore = received.length;
    socks.get(dev1).send(JSON.stringify({ type: 'bridge_notice', notice: 'approval_pending', taskId: 'harness-task-notice-0001', toolName: 'file_ops' }));
    const ap = await waitEv((e) => e.ev === 'approvalPending');
    assert.deepEqual([ap.taskId, ap.toolName, ap.folder], ['harness-task-notice-0001', 'file_ops', realFolder], 'approvalPending 이벤트');
    socks.get(dev1).send(JSON.stringify({ type: 'bridge_notice', notice: 'approval_pending', taskId: '../escape', toolName: 'x' }));
    socks.get(dev1).send(JSON.stringify({ type: 'bridge_notice', notice: 'exec_now', taskId: 'harness-task-notice-0002', toolName: 'x' }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(events.filter((e) => e.ev === 'approvalPending').length, 1, '부적합 알림은 버린다');
    assert.equal(received.length, framesBefore, '알림은 단방향 — 헬퍼가 응답 프레임을 보내지 않는다');

    // ③ exec — denylist / stdio confirm 승인 / 거부
    assert.equal((await execVia(dev1, { kind: 'exec', command: 'sudo ls' })).exitCode, 126, 'denylist 126');
    const runP = execVia(dev1, { kind: 'exec', command: 'echo -n from-companion', taskId: 'harness-task-000000000001' });
    const c1 = await waitEv((e) => e.ev === 'confirm');
    assert.ok(c1.command.includes('from-companion') && c1.sandbox === true, 'confirm 이벤트 내용');
    assert.equal(c1.folder, realFolder, 'confirm 이벤트 루트 표기');
    assert.equal(c1.taskId, 'harness-task-000000000001', 'H12 confirm taskId 글자');
    send({ cmd: 'confirm', id: c1.id, result: 'yes' });
    const ran = await runP;
    assert.deepEqual([ran.ok, ran.stdout], [true, 'from-companion'], 'confirm yes → 실행');
    const denyP = execVia(dev1, { kind: 'exec', command: 'echo denied-cmd' });
    const c2 = await waitEv((e) => e.ev === 'confirm' && e.id !== c1.id);
    assert.strictEqual(c2.taskId, null, 'H12 작업 없는 exec 의 confirm.taskId 는 null');
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

    // H6 clearAutoApprove — all 승인을 회수하면(count 0) 같은 작업의 다음 exec 가 다시 confirm 을 낸다
    const t6 = 'harness-task-000000000006';
    const n6 = events.length;
    const h6P = execVia(dev1, { kind: 'exec', command: 'echo -n h6-first', taskId: t6 });
    const c6 = await waitEv((e) => e.ev === 'confirm' && e.command.includes('h6-first'));
    send({ cmd: 'confirm', id: c6.id, result: 'all' });
    assert.equal((await h6P).stdout, 'h6-first', 'H6 all 승인 실행');
    await waitEvAfter(n6, (e) => e.ev === 'autoApprove' && e.count === 1);
    const n6b = events.length;
    send({ cmd: 'clearAutoApprove' });
    await waitEvAfter(n6b, (e) => e.ev === 'autoApprove' && e.count === 0);
    const h6Q = execVia(dev1, { kind: 'exec', command: 'echo -n h6-again', taskId: t6 });
    const c6b = await waitEv((e) => e.ev === 'confirm' && e.command.includes('h6-again'));
    send({ cmd: 'confirm', id: c6b.id, result: 'yes' });
    assert.equal((await h6Q).stdout, 'h6-again', 'H6 회수 뒤 다시 확인');

    // ④ folders 열거 / browser 미지원 / worktree
    assert.deepEqual((await execVia(dev1, { kind: 'folders', path: '.' })).entries, ['subdir'], 'folders 열거');
    // 브라우저를 켜지 않은 헬퍼(OMK_COMPANION_BROWSER 없음)는 browser 요청을 실행하지 않는다
    assert.equal((await execVia(dev1, { kind: 'browser', actions: [{ type: 'goto', url: 'https://example.com' }] })).ok, false, 'browser 미설정 거부');
    // 제어권·중지 명령은 이벤트로 되돌아온다(앱이 메뉴 상태를 맞춘다)
    send({ cmd: 'browserControl', user: true });
    await waitEv((e) => e.ev === 'browserControl' && e.user === true);
    // 넘겨받기·돌려주기는 서버에도 단방향 프레임으로 알린다(서버가 넘겨받기로 멈춘 작업을 재개한다)
    await waitFor((f) => f.type === 'bridge_event' && f.kind === 'browser_control' && f.user === true);
    send({ cmd: 'browserControl', user: false });
    await waitEv((e) => e.ev === 'browserControl' && e.user === false);
    await waitFor((f) => f.type === 'bridge_event' && f.kind === 'browser_control' && f.user === false);
    send({ cmd: 'browserStop' });
    await waitEv((e) => e.ev === 'browserStopped');
    const taskId = 'harness-task-000000000003';
    const wt = await execVia(dev1, { kind: 'worktree', op: 'add', taskId });
    assert.ok(wt.ok && wt.worktreeRel.endsWith(taskId), 'worktree add');
    fs.writeFileSync(path.join(folder, wt.worktreeRel, 'change.txt'), 'diff-me');
    const diff = await execVia(dev1, { kind: 'worktree', op: 'diff', taskId });
    assert.ok(diff.ok && diff.stdout.includes('diff-me'), 'worktree diff');

    // ④-B code_nav — 읽기 전용 코드 탐색(grep_code·repo_map 백엔드). 셸을 거치지 않으므로
    //      confirm 이벤트가 발생하면 안 된다(발생하면 실사용에서 탐색마다 승인 창이 뜬다).
    fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'src/nav.js'), 'function navTarget() {\n  return 1;\n}\n');
    fs.mkdirSync(path.join(folder, 'node_modules/pkg'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'node_modules/pkg/i.js'), 'function navTarget() {}\n');
    const navConfirms = events.filter((e) => e.ev === 'confirm').length;
    const grepR = await execVia(dev1, { kind: 'code_nav', op: 'grep', pattern: 'function navTarget' });
    assert.ok(grepR.ok && grepR.codeNav.matches.includes('src/nav.js:1:function navTarget() {'), 'code_nav grep 매치');
    assert.ok(!grepR.codeNav.matches.some((m) => m.startsWith('node_modules/')), 'code_nav 제외 디렉토리');
    const filesR = await execVia(dev1, { kind: 'code_nav', op: 'files', path: 'src' });
    assert.deepEqual(filesR.codeNav.files, [{ path: 'src/nav.js', lines: 3 }], 'code_nav files 줄 수');
    assert.equal(events.filter((e) => e.ev === 'confirm').length, navConfirms, 'code_nav 는 승인 창을 띄우지 않는다');
    assert.equal((await execVia(dev1, { kind: 'code_nav', op: 'grep', pattern: 'x', path: '../..' })).ok, false, 'code_nav 스코프 탈출 거부');
    // 자격증명 파일은 훑지 않는다 — 승인이 도구 단위라 사용자는 어떤 파일을 읽을지 못 본다.
    fs.writeFileSync(path.join(folder, '.env'), 'API_KEY=harness-secret\n');
    const secretR = await execVia(dev1, { kind: 'code_nav', op: 'grep', pattern: 'harness-secret' });
    assert.deepEqual(secretR.codeNav.matches, [], 'code_nav 자격증명 미검색');
    assert.equal(secretR.codeNav.skipped, 1, 'code_nav 건너뛴 수 보고');
    assert.ok((await execVia(dev1, { kind: 'read', path: '.env' })).content.includes('harness-secret'), '경로 지목 read 는 그대로 동작');

    // ⑤ 다중 루트 — 두 번째 루트 연결: 파생 deviceId 상이, 루트별 스코프 격리, 개별 해제
    send({ cmd: 'connect', folder: folder2 });
    const hello2 = await waitFor((f) => f.type === 'bridge_hello' && f.folderName === path.basename(folder2));
    const dev2 = hello2.deviceId;
    assert.notEqual(dev2, dev1, '루트별 파생 deviceId 상이');
    assert.ok(dev1.length <= 64 && dev2.length <= 64, 'deviceId 64자 상한');
    assert.ok(dev1.split('-r-')[0] === dev2.split('-r-')[0], '기기 base id 공유');
    // 능력 목록·PC 식별자(Companion P1) — 폴더별 연결이 같은 hostId 를 보내 서버가 PC 1대로 센다
    assert.equal(hello.hostId, dev1.split('-r-')[0], 'hello hostId = 기기 base id');
    assert.equal(hello2.hostId, hello.hostId, '루트가 달라도 hostId 는 같다');
    assert.ok(Array.isArray(hello.capabilities) && hello.capabilities.includes('exec') && hello.capabilities.includes('read'), 'hello 에 지원 요청 종류');
    assert.ok(!hello.capabilities.includes('browser'), '브라우저를 켜지 않으면 능력 목록에 browser 가 없다');
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
    // H7 같은 루트 재연결 — 새 hello(같은 deviceId), disconnected 없음
    const r7 = received.length;
    const n7 = events.length;
    send({ cmd: 'connect', folder: folder2 });
    await waitForAfter(r7, (f) => f.type === 'bridge_hello' && f.deviceId === dev2);
    await waitEvAfter(n7, (e) => e.ev === 'status' && e.folder === realFolder2 && e.code === 'connected');
    assert.ok(!events.some((e) => e.ev === 'disconnected'), 'H7 재연결은 disconnected 를 내지 않는다');
    // 루트1 개별 해제 — 루트2 는 유지
    send({ cmd: 'disconnect', folder });
    await waitEv((e) => e.ev === 'disconnected' && e.folder === realFolder);
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!socks.has(dev1), '루트1 소켓 종료');
    assert.equal((await execVia(dev2, { kind: 'read', path: 'other.txt' })).content, 'other-root', '루트1 해제 후 루트2 생존');

    // ⑤-B 인증 사유로 닫힘(0.3.2) — hello 에 authClose 를 싣고, 서버가 1008 api_key_revoked 로 닫으면
    //      그 루트의 상태 코드가 사유 그대로 올라온다(앱이 "API key 가 폐기되었습니다" 로 번역). 곧바로 다시 붙지 않는다.
    assert.equal(hello.authClose, true, 'hello authClose');
    send({ cmd: 'connect', folder });
    await waitFor((f) => f.type === 'bridge_hello' && f.folderName === path.basename(folder) && socks.has(f.deviceId));
    const hellosBefore = hellos.length;
    socks.get(dev1).close(1008, 'api_key_revoked');
    await waitEv((e) => e.ev === 'status' && e.folder === realFolder && e.code === 'api_key_revoked');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(hellos.length, hellosBefore, '인증 사유로 닫히면 곧바로 다시 연결하지 않는다');
    send({ cmd: 'disconnect', folder });
    await waitEv((e) => e.ev === 'disconnected' && e.folder === realFolder && events.filter((x) => x.ev === 'disconnected' && x.folder === realFolder).length >= 2);

    // ⑥ stdin 종료 = 정리 종료 (좀비 방지) — pending confirm 은 'no' 로 해소
    const zombieP = execVia(dev2, { kind: 'exec', command: 'echo never-runs' });
    await waitEv((e) => e.ev === 'confirm' && e.command.includes('never-runs'));
    helper.stdin.end();
    const code = await new Promise((r) => helper.on('exit', r));
    assert.equal(code, 0, 'stdin 종료 → exit 0');
    const zombieR = await zombieP;
    assert.deepEqual([zombieR.ok, zombieR.exitCode], [false, 126], '종료 시 pending confirm 거부 해소');

    // ── 따로 띄우는 헬퍼(H3·H4·H5·H11·H8·H9·H10) — 주 헬퍼가 끝난 뒤에(같은 기기 base id 라 deviceId 가 겹친다).
    //    실패해도 자식이 남지 않게 finally 에서 죽인다.
    const side = async (args, opts, fn) => {
        const child = spawnHelper(args, opts);
        try { return await fn(child); } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    };
    const connectedIn = (t, real) => t.waitEv((e) => e.ev === 'status' && e.folder === real && e.code === 'connected');

    // H3 --resolve — stdout 전체가 JSON 한 줄(같은 세 값), exit 0, stdin 을 주지 않아도(/dev/null) 끝난다
    await side(['--server', serverUrl, '--resolve'], { stdio: ['ignore', 'pipe', 'inherit'] }, async (p) => {
        let out = '';
        p.stdout.setEncoding('utf8');
        p.stdout.on('data', (d) => { out += d; });
        assert.deepEqual(await exitOf(p), [0, null], 'H3 --resolve exit 0');
        assert.ok(out.endsWith('\n') && out.indexOf('\n') === out.length - 1, 'H3 --resolve 는 정확히 한 줄: ' + JSON.stringify(out));
        assert.deepEqual(JSON.parse(out), { bridgeUrl: serverUrl, webUrl: serverUrl, discovered: false }, 'H3 --resolve 값');
    });

    // H4 키 없는 connect · H5 없는 폴더 · H11 버리는 입력 · H8 폴더 없는 disconnect
    await side(['--server', serverUrl], {}, async (b) => {
        const t = track(b);
        const h0 = hellos.length;
        t.send({ cmd: 'connect', folder });
        assert.deepEqual(await t.waitEv((e) => e.code === 'api_key_required'),
            { ev: 'status', text: 'API key 필요 — 앱 설정에서 입력', code: 'api_key_required' }, 'H4 키 없는 connect');
        t.send({ cmd: 'auth', apiKey: 'omk_live_harness' });
        t.send({ cmd: 'connect', folder: path.join(folder, 'no-such-dir') });
        const fo = await t.waitEv((e) => e.code === 'folder_open_failed');
        assert.ok(typeof fo.arg === 'string' && fo.arg.length > 0 && fo.text === '폴더 열기 실패: ' + fo.arg && !('folder' in fo), 'H5 폴더 열기 실패');
        t.send({ cmd: 'connect', folder });
        t.send({ cmd: 'connect', folder: folder2 });
        await connectedIn(t, realFolder);
        await connectedIn(t, realFolder2);
        assert.equal(hellos.length - h0, 2, 'H4 키 없던 connect 는 붙지 않았다');
        // H11 — 빈 줄·JSON 아님·모르는 cmd·없는 확인 id·문자열·수(null 줄은 넣지 않는다 — Node 헬퍼가 죽는다)
        for (const l of ['', 'not json', '{"cmd":"nope"}', '{"cmd":"confirm","id":999,"result":"yes"}', '"문자열"', '123']) b.stdin.write(l + '\n');
        t.send({ cmd: 'browserStop' });
        await t.waitEv((e) => e.ev === 'browserStopped');
        assert.equal((await execVia(dev2, { kind: 'read', path: 'other.txt' })).content, 'other-root', 'H11 버리는 입력 뒤에도 정상');
        const n8 = t.events.length;
        t.send({ cmd: 'disconnect' });
        await t.waitEvAfter(n8, (e) => e.ev === 'status' && !('folder' in e) && e.code === 'idle');
        const tail = t.events.slice(n8).filter((e) => e.ev === 'disconnected' || (e.ev === 'status' && !('folder' in e)));
        assert.deepEqual(tail, [{ ev: 'disconnected', folder: realFolder }, { ev: 'disconnected', folder: realFolder2 },
            { ev: 'status', text: '미연결', code: 'idle' }], 'H8 전체 해제 — disconnected 둘 + 마지막 status idle');
        b.stdin.end();
        assert.deepEqual(await exitOf(b), [0, null], 'H8 뒤 stdin 끝 exit 0');
    });

    // H9 quit — 확인 대기가 [false,126] 으로 풀리고 exit 0
    await side(['--server', serverUrl], {}, async (c) => {
        const t = track(c);
        t.send({ cmd: 'auth', apiKey: 'omk_live_harness' });
        t.send({ cmd: 'connect', folder: folder2 });
        await connectedIn(t, realFolder2);
        const pendingP = execVia(dev2, { kind: 'exec', command: 'echo h9-never-runs' });
        await t.waitEv((e) => e.ev === 'confirm' && e.command.includes('h9-never-runs'));
        t.send({ cmd: 'quit' });
        assert.deepEqual(await exitOf(c), [0, null], 'H9 quit → exit 0');
        const r = await pendingP;
        assert.deepEqual([r.ok, r.exitCode], [false, 126], 'H9 quit 시 확인 대기 거부');
    });

    // H10 SIGTERM — 신호로 죽은 것이 아니라 스스로 끝난다(code 0, signal null)
    await side(['--server', serverUrl], {}, async (d) => {
        const t = track(d);
        t.send({ cmd: 'auth', apiKey: 'omk_live_harness' });
        t.send({ cmd: 'connect', folder: folder2 });
        await connectedIn(t, realFolder2);
        d.kill('SIGTERM');
        assert.deepEqual(await exitOf(d), [0, null], 'H10 SIGTERM → exit 0, signal null');
    });

    wss.close();
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(folder2, { recursive: true, force: true });
    console.log('OK — Companion 헬퍼 하네스 전 케이스 통과 (helper=%s, frames=%d, events=%d, roots=2)', HELPER_NAME, received.length, events.length);
    process.exit(0);
})().catch((e) => { console.error('HARNESS FAIL:', e.message); process.exit(1); });
