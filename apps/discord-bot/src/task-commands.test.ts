/**
 * /task 조정자 — 권한, 채널당 한 작업, 시작 실패 정리, 승인·취소의 주인 확인을 가짜 클라이언트로 고정한다.
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PendingApproval, TaskClient, TaskInputAttachments, TaskSnapshot } from './task-client';
import { createTaskController, type TaskControllerConfig } from './task-commands';
import type { WatchUi } from './task-watcher';

const OWNER = 'u-owner';
const OTHER_ALLOWED = 'u-other';
const STRANGER = 'u-stranger';

const baseConfig: TaskControllerConfig = { allowedUsers: [OWNER, OTHER_ALLOWED], executor: 'sandbox', approvalPolicy: 'all', pollMs: 1, watchMaxMs: 60_000 };
const snap = (over: Partial<TaskSnapshot>): TaskSnapshot => ({ id: 't1', status: 'running', progress: 0, currentTurn: 0, maxTurns: 32, result: null, error: null, continuedByTaskId: null, completionPath: null, ...over });

interface Fake extends TaskClient { createdWith?: TaskInputAttachments; log: string[]; snapshots: TaskSnapshot[]; pending: PendingApproval[]; connected: boolean; failExecute: boolean; decision: 'ok' | 'gone' }

function fakeClient(over: Partial<Fake> = {}): Fake {
    const f: Fake = {
        log: [],
        snapshots: [snap({ status: 'completed', result: '끝' })],
        pending: [],
        connected: true,
        failExecute: false,
        decision: 'ok',
        async createTask(goal, executor, attachments) { f.log.push(`create:${executor}:${goal}`); f.createdWith = attachments; return 't1'; },
        async executeTask(id, policy) { f.log.push(`execute:${id}:${policy}`); if (f.failExecute) throw new Error('큐가 가득 찼습니다'); },
        async getTask() { return f.snapshots.length > 1 ? (f.snapshots.shift() as TaskSnapshot) : f.snapshots[0]; },
        async cancelTask(id) { f.log.push(`cancel:${id}`); },
        async listPendingApprovals() { return f.pending; },
        async decideApproval(id, decision) { f.log.push(`decide:${id}:${decision}`); return f.decision; },
        async isDeviceConnected() { f.log.push('device?'); return f.connected; },
        ...over,
    };
    return f;
}

/** 결과가 올라올 때 풀리는 약속을 가진 화면 */
function screen() {
    const approvals: PendingApproval[] = [];
    const finals: string[] = [];
    let release: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => { release = resolve; });
    const ui: WatchUi = {
        updateStatus: async () => undefined,
        postApproval: async (a) => { approvals.push(a); },
        postFinal: async (t) => { finals.push(t); release(); },
    };
    return { ui, approvals, finals, finished };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
/** 끝나지 않는 가짜 작업의 지켜보기가 테스트 뒤에 남아 돌지 않게, 지켜보는 시간을 짧게 준다 */
const make = (client: TaskClient, config: Partial<TaskControllerConfig> = {}) => createTaskController({ client, config: { ...baseConfig, watchMaxMs: 400, ...config }, sleep: async () => { await tick(); } });

test('시작: 첨부를 작업 생성에 넘긴다(없으면 넘기지 않는다)', async () => {
    const attachments: TaskInputAttachments = { files: [{ name: 'a.pdf', type: 'application/pdf', size: 3, data: 'QUJD' }], images: ['data:image/png;base64,iVBORw0KGgo='] };
    const withFiles = fakeClient();
    await make(withFiles).start({ userId: OWNER, channelId: 'c1', goal: 'a.pdf 요약', ui: screen().ui, attachments });
    assert.deepEqual(withFiles.createdWith, attachments);
    const without = fakeClient();
    await make(without).start({ userId: OWNER, channelId: 'c1', goal: '요약', ui: screen().ui });
    assert.equal(without.createdWith, undefined);
});

test('허용 목록이 비어 있으면 꺼져 있고 누구도 시작하지 못한다', async () => {
    const client = fakeClient();
    const c = make(client, { allowedUsers: [] });
    assert.equal(c.isEnabled(), false);
    const r = await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui: screen().ui });
    assert.equal(r.ok, false);
    assert.deepEqual(client.log, []);
});

test('허용 목록 밖 사용자와 빈 목표는 서버를 부르지 않고 거절한다', async () => {
    const client = fakeClient();
    const c = make(client);
    assert.equal((await c.start({ userId: STRANGER, channelId: 'c1', goal: 'x', ui: screen().ui })).ok, false);
    assert.equal((await c.start({ userId: OWNER, channelId: 'c1', goal: '   ', ui: screen().ui })).ok, false);
    assert.deepEqual(client.log, []);
});

test('시작: 만들고 실행한 뒤 지켜보고, 끝나면 채널이 다시 빈다', async () => {
    const client = fakeClient();
    const c = make(client);
    const s = screen();
    assert.deepEqual(await c.start({ userId: OWNER, channelId: 'c1', goal: ' 로그 집계 ', ui: s.ui }), { ok: true, taskId: 't1' });
    assert.deepEqual(client.log, ['create:sandbox:로그 집계', 'execute:t1:all']);
    await s.finished;
    await tick();
    assert.equal(s.finals.length, 1);
    const again = screen();
    assert.equal((await c.start({ userId: OWNER, channelId: 'c1', goal: '다음 작업', ui: again.ui })).ok, true);
});

test('같은 채널에 거의 동시에 온 두 번째 요청은 거절되고 작업은 하나만 만들어진다', async () => {
    const client = fakeClient({ snapshots: [snap({ status: 'running' })] });
    const c = make(client);
    const [a, b] = await Promise.all([
        c.start({ userId: OWNER, channelId: 'c1', goal: '첫째', ui: screen().ui }),
        c.start({ userId: OTHER_ALLOWED, channelId: 'c1', goal: '둘째', ui: screen().ui }),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, false);
    assert.equal(client.log.filter((l) => l.startsWith('create:')).length, 1);
    // 다른 채널은 따로 받는다
    assert.equal((await c.start({ userId: OTHER_ALLOWED, channelId: 'c2', goal: '셋째', ui: screen().ui })).ok, true);
});

test('local 인데 연결된 기기가 없으면 작업을 만들지 않고, 채널도 비워 둔다', async () => {
    const client = fakeClient({ connected: false });
    const c = make(client, { executor: 'local' });
    const r = await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui: screen().ui });
    assert.equal(r.ok, false);
    assert.deepEqual(client.log, ['device?']);
    client.connected = true;
    assert.equal((await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui: screen().ui })).ok, true);
    assert.ok(client.log.includes('create:local:x'));
});

test('실행 요청이 실패하면 만든 작업을 취소하고 사유를 돌려준다', async () => {
    const client = fakeClient({ failExecute: true });
    const c = make(client);
    const r = await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui: screen().ui });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /큐가 가득 찼습니다/);
    assert.deepEqual(client.log, ['create:sandbox:x', 'execute:t1:all', 'cancel:t1']);
    client.failExecute = false;
    assert.equal((await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui: screen().ui })).ok, true);
});

test('취소: 시작한 사람만 할 수 있고, 진행 중인 작업이 없으면 그렇게 알린다', async () => {
    const client = fakeClient({ snapshots: [snap({ status: 'running' })] });
    const c = make(client);
    assert.match(await c.cancel({ userId: OWNER, channelId: 'c1' }), /진행 중인 작업이 없습니다/);
    await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui: screen().ui });
    assert.match(await c.cancel({ userId: OTHER_ALLOWED, channelId: 'c1' }), /시작한 사람만/);
    assert.equal(client.log.includes('cancel:t1'), false);
    assert.match(await c.cancel({ userId: OWNER, channelId: 'c1' }), /취소를 요청했습니다/);
    assert.equal(client.log.includes('cancel:t1'), true);
});

test('승인: 지켜보기가 올린 요청만, 작업을 시작한 사람만 결정할 수 있다', async () => {
    const a1 = { approvalId: 'a1', taskId: 't1', toolName: 'bash', args: { command: 'ls' } };
    const client = fakeClient({ snapshots: [snap({ status: 'paused' })], pending: [a1] });
    const c = make(client);
    const s = screen();
    await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui: s.ui });
    while (s.approvals.length === 0) await tick();

    const stranger = await c.decide({ userId: OTHER_ALLOWED, approvalId: 'a1', decision: 'approve' });
    assert.deepEqual([stranger.settled, /시작한 사람만/.test(stranger.text)], [false, true]);
    const unknown = await c.decide({ userId: OWNER, approvalId: 'zzz', decision: 'approve' });
    assert.deepEqual([unknown.settled, /찾을 수 없습니다/.test(unknown.text)], [false, true]);
    assert.equal(client.log.some((l) => l.startsWith('decide:')), false);

    const okResult = await c.decide({ userId: OWNER, approvalId: 'a1', decision: 'approve' });
    assert.deepEqual([okResult.settled, /승인됨/.test(okResult.text)], [true, true]);
    assert.ok(client.log.includes('decide:a1:approve'));
    // 한 번 끝난 요청은 다시 누를 수 없다(버튼 두 번 누르기)
    assert.equal((await c.decide({ userId: OWNER, approvalId: 'a1', decision: 'approve' })).settled, false);
});

test('승인: 웹에서 먼저 처리된 요청(gone)은 끝난 것으로 알린다, 거절은 거절됨', async () => {
    const a1 = { approvalId: 'a1', taskId: 't1', toolName: 'bash', args: {} };
    const a2 = { approvalId: 'a2', taskId: 't1', toolName: 'bash', args: {} };
    const client = fakeClient({ snapshots: [snap({ status: 'paused' })], pending: [a1, a2], decision: 'gone' });
    const c = make(client);
    const s = screen();
    await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui: s.ui });
    while (s.approvals.length < 2) await tick();
    const gone = await c.decide({ userId: OWNER, approvalId: 'a1', decision: 'approve' });
    assert.deepEqual([gone.settled, /이미 처리된/.test(gone.text)], [true, true]);
    client.decision = 'ok';
    const rejected = await c.decide({ userId: OWNER, approvalId: 'a2', decision: 'reject' });
    assert.deepEqual([rejected.settled, /거절됨/.test(rejected.text)], [true, true]);
});

test('승인 결정 호출이 실패하면 버튼을 남겨 두고(끝나지 않음) 사유를 알린다', async () => {
    const a1 = { approvalId: 'a1', taskId: 't1', toolName: 'bash', args: {} };
    const client = fakeClient({ snapshots: [snap({ status: 'paused' })], pending: [a1] });
    client.decideApproval = async () => { throw new Error('ECONNREFUSED'); };
    const c = make(client);
    const s = screen();
    await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui: s.ui });
    while (s.approvals.length === 0) await tick();
    const r = await c.decide({ userId: OWNER, approvalId: 'a1', decision: 'approve' });
    assert.deepEqual([r.settled, /ECONNREFUSED/.test(r.text)], [false, true]);
});

test('채널에 글을 올릴 수 없으면 작업을 만들지 않는다 — 보이지 않는 작업을 남기지 않는다', async () => {
    const client = fakeClient();
    const c = make(client);
    const ui: WatchUi = { updateStatus: async () => { throw new Error('Missing Access'); }, postApproval: async () => undefined, postFinal: async () => undefined };
    const r = await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /이 채널에 메시지를 올릴 수 없어/);
    assert.deepEqual(client.log, []);
    // 자리도 풀려 있다
    assert.equal((await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui: screen().ui })).ok, true);
});

test('지켜보는 시간이 끝난 작업도 시작한 사람이 /task-cancel 로 멈출 수 있다 — 한 번 취소하면 잊는다', async () => {
    const client = fakeClient({ snapshots: [snap({ status: 'running' })] });
    const c = make(client, { watchMaxMs: 0 });
    const s = screen();
    await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui: s.ui });
    await s.finished; // 시간 초과 안내
    await tick();
    assert.equal(await c.cancel({ userId: OTHER_ALLOWED, channelId: 'c1' }), '작업을 시작한 사람만 할 수 있습니다.');
    assert.match(await c.cancel({ userId: OWNER, channelId: 'c1' }), /취소를 요청했습니다/);
    assert.deepEqual(client.log.filter((l) => l.startsWith('cancel')), ['cancel:t1']);
    assert.equal(await c.cancel({ userId: OWNER, channelId: 'c1' }), '이 채널에 진행 중인 작업이 없습니다.');
});

test('정상으로 끝난 작업은 /task-cancel 대상으로 남지 않는다', async () => {
    const client = fakeClient();
    const c = make(client);
    const s = screen();
    await c.start({ userId: OWNER, channelId: 'c1', goal: 'x', ui: s.ui });
    await s.finished;
    await tick();
    assert.equal(await c.cancel({ userId: OWNER, channelId: 'c1' }), '이 채널에 진행 중인 작업이 없습니다.');
    assert.deepEqual(client.log.filter((l) => l.startsWith('cancel')), []);
});

test('trackApproval — 채팅에서 위임한 작업의 승인 요청도 주인이 버튼으로 결정한다', async () => {
    const client = fakeClient();
    const c = make(client);
    c.trackApproval('ap-9', OWNER);
    const byOther = await c.decide({ userId: OTHER_ALLOWED, approvalId: 'ap-9', decision: 'approve' });
    assert.equal(byOther.settled, false);
    const byOwner = await c.decide({ userId: OWNER, approvalId: 'ap-9', decision: 'approve' });
    assert.equal(byOwner.settled, true);
    assert.deepEqual(client.log, ['decide:ap-9:approve']);
});
