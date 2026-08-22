/**
 * 데스크톱 브리지 헤드리스 하네스 — electron 없이 bridge.js 회귀 검증.
 *
 * Module._load 로 electron(session/dialog)·agent-browser 를 스텁하고, 가짜 브리지 WS
 * 서버에 연결해 실제 kind 왕복(read/write/exec/worktree/folders/task_end)을 돈다.
 * 코어 추출(2026-08-22) 후 어댑터 재배선이 종전 계약을 지키는지의 회귀 가드.
 *
 * 실행: node apps/desktop/bridge-harness.cjs   (사전: npm run build:packages + 코어 복사
 *       — copy-desktop-bridge-core.mjs. prestart 훅과 동일)
 * 종료코드 0 = 전 케이스 통과.
 */
process.env.OMK_BRIDGE_TOKEN = 'harness-token';
process.env.OMK_BRIDGE_AUTO_APPROVE = '1'; // 다이얼로그 없이 exec 승인 (E2E 훅)

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const { WebSocketServer } = require('ws');

// ── electron / agent-browser 스텁 ──
const dialogCalls = [];
const stubs = {
    electron: {
        session: { defaultSession: { cookies: { get: async () => [] } } }, // OMK_BRIDGE_TOKEN 경로만 사용
        dialog: {
            showMessageBox: async (...a) => { dialogCalls.push(a); return { response: 0 }; },
            showOpenDialog: async () => { throw new Error('하네스는 OMK_BRIDGE_FOLDER 를 쓴다'); },
        },
    },
    './agent-browser': {
        configure: () => {},
        closeAll: () => { stubs.browserClosed += 1; },
        runActions: async () => ({ ok: true, harness: true }),
    },
    browserClosed: 0,
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return stubs.electron;
    if (request === './agent-browser' && parent && parent.filename.endsWith('bridge.js')) return stubs['./agent-browser'];
    return origLoad.call(this, request, parent, isMain);
};

const fakeApp = {
    getPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'omk-userdata-')),
};

(async () => {
    // 작업 폴더: git 레포로 준비 (worktree 검증)
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-dtharness-'));
    const git = (args) => execFileSync('git', args, { cwd: folder, encoding: 'utf8' });
    git(['init', '-q']);
    git(['-c', 'user.email=h@h', '-c', 'user.name=h', 'commit', '--allow-empty', '-q', '-m', 'init']);
    fs.writeFileSync(path.join(folder, 'seed.txt'), 'seed');
    fs.mkdirSync(path.join(folder, 'subdir'));
    process.env.OMK_BRIDGE_FOLDER = folder;

    // 가짜 서버
    const received = [];
    const waiters = [];
    const wss = new WebSocketServer({ port: 0 });
    await new Promise((r) => wss.once('listening', r));
    const port = wss.address().port;
    let sock = null;
    let helloHeaders = null;
    wss.on('connection', (ws, req) => {
        sock = ws; helloHeaders = req.headers;
        ws.on('message', (d) => {
            const f = JSON.parse(d.toString());
            received.push(f);
            for (let i = waiters.length - 1; i >= 0; i--) {
                if (waiters[i].pred(f)) { waiters[i].resolve(f); waiters.splice(i, 1); }
            }
            if (f.type === 'bridge_hello') ws.send(JSON.stringify({ type: 'bridge_ready' }));
        });
    });
    const waitFor = (pred, ms = 8000) => {
        const hit = received.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('frame timeout: ' + received.map((f) => f.type).join(','))), ms);
            waiters.push({ pred, resolve: (f) => { clearTimeout(t); resolve(f); } });
        });
    };
    const exec = (m) => {
        const reqId = 'h-' + Math.random().toString(36).slice(2, 8);
        sock.send(JSON.stringify({ type: 'bridge_exec', reqId, ...m }));
        return waitFor((f) => f.type === 'bridge_result' && f.reqId === reqId).then((f) => f.result);
    };

    const bridge = require('./bridge');
    const statuses = [];
    bridge.setOnStatusChange((s) => statuses.push(s));
    await bridge.connectFolder(fakeApp, `http://127.0.0.1:${port}`, null);

    // ① hello — 쿠키+Origin 인증 헤더, 디바이스 메타
    const hello = await waitFor((f) => f.type === 'bridge_hello');
    assert.equal(hello.folderName, path.basename(folder), 'hello folderName');
    assert.ok(String(helloHeaders.cookie).includes('auth_token=harness-token'), '쿠키 인증 헤더');
    assert.ok(String(helloHeaders.origin).startsWith('http://127.0.0.1'), 'Origin 헤더');
    assert.ok(bridge.isConnected() && bridge.getFolderPath() === fs.realpathSync(folder), '연결 상태 API');

    // ② 파일 kind 왕복 + 스코프
    assert.equal((await exec({ kind: 'read', path: 'seed.txt' })).content, 'seed', 'read');
    await exec({ kind: 'write', path: 'subdir/out.txt', contentB64: Buffer.from('written').toString('base64') });
    assert.equal(fs.readFileSync(path.join(folder, 'subdir/out.txt'), 'utf8'), 'written', 'write');
    const esc = await exec({ kind: 'read', path: '../../etc/hosts' });
    assert.equal(esc.ok, false, '스코프 탈출 거부');

    // ③ exec (denylist / 자동승인 실행)
    const denied = await exec({ kind: 'exec', command: 'sudo ls' });
    assert.equal(denied.exitCode, 126, 'denylist 126');
    const ran = await exec({ kind: 'exec', command: 'echo -n from-desktop' });
    assert.deepEqual([ran.ok, ran.stdout], [true, 'from-desktop'], 'exec 실행');

    // ④ folders 열거 (숨김 제외)
    const folders = await exec({ kind: 'folders', path: '.' });
    assert.deepEqual(folders.entries, ['subdir'], 'folders 열거');

    // ⑤ worktree add→diff
    const taskId = 'harness-task-000000000000';
    const wt = await exec({ kind: 'worktree', op: 'add', taskId });
    assert.ok(wt.ok && wt.worktreeRel.endsWith(taskId), 'worktree add');
    fs.writeFileSync(path.join(folder, wt.worktreeRel, 'change.txt'), 'diff-me');
    const diff = await exec({ kind: 'worktree', op: 'diff', taskId });
    assert.ok(diff.ok && diff.stdout.includes('diff-me'), 'worktree diff');

    // ⑥ browser 어댑터 (스텁) + task_end 브라우저 정리 훅
    const br = await exec({ kind: 'browser', spec: {} });
    assert.ok(br.ok && JSON.parse(br.stdout).harness === true, 'browser 어댑터');
    await exec({ kind: 'task_end', taskId });
    assert.equal(stubs.browserClosed, 1, 'task_end → agent-browser.closeAll');

    // ⑦ 해제 — 상태·일괄승인 회수
    bridge.disconnectFolder();
    assert.equal(bridge.isConnected(), false, '해제');
    assert.equal(bridge.autoApprovedCount(), 0, '일괄 승인 회수');

    wss.close();
    console.log('OK — 데스크톱 하네스 전 케이스 통과 (frames=%d, 상태전이=%s)', received.length, statuses.join(' → '));
    process.exit(0);
})().catch((e) => { console.error('HARNESS FAIL:', e.message); process.exit(1); });
