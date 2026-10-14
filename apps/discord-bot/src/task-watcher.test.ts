/**
 * 작업 지켜보기 — 조회 → 진행 표시 → 승인 요청 → 끝 처리 흐름을 가짜 클라이언트와 가짜 화면으로 돌린다.
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TaskApiError, type PendingApproval, type TaskSnapshot } from './task-client';
import { formatApproval, formatFinal, formatStatus, isTerminalStatus, watchTask, type WatchOptions, type WatchUi } from './task-watcher';

const snap = (over: Partial<TaskSnapshot>): TaskSnapshot => ({ id: 't1', status: 'running', progress: 0, currentTurn: 0, maxTurns: 32, result: null, error: null, continuedByTaskId: null, completionPath: null, ...over });
const info = { goal: '로그에서 오류 건수 집계', executorLabel: '서버 격리 환경', policyLabel: '전부' };

function screen() {
    const statuses: string[] = [];
    const approvals: PendingApproval[] = [];
    const finals: string[] = [];
    const ui: WatchUi = {
        updateStatus: async (t) => { statuses.push(t); },
        postApproval: async (a) => { approvals.push(a); },
        postFinal: async (t) => { finals.push(t); },
    };
    return { ui, statuses, approvals, finals };
}

/** 정해 둔 순서대로 응답하는 가짜 클라이언트 — 함수면 불러서(던지게도) 쓴다 */
function scripted(steps: Array<TaskSnapshot | (() => TaskSnapshot)>, pending: PendingApproval[][] = []) {
    let i = 0;
    let p = 0;
    return {
        calls: () => i,
        client: {
            getTask: async () => {
                const step = steps[Math.min(i, steps.length - 1)];
                i += 1;
                return typeof step === 'function' ? step() : step;
            },
            listPendingApprovals: async () => pending[Math.min(p++, pending.length - 1)] ?? [],
        },
    };
}

const opts = (over: Partial<WatchOptions> = {}): WatchOptions => ({ ...info, pollMs: 1, watchMaxMs: 60_000, sleep: async () => undefined, ...over });

test('끝난 상태는 completed·failed·cancelled 뿐이다', () => {
    assert.equal(isTerminalStatus('completed'), true);
    assert.equal(isTerminalStatus('failed'), true);
    assert.equal(isTerminalStatus('cancelled'), true);
    for (const s of ['pending', 'queued', 'running', 'paused', 'unknown']) assert.equal(isTerminalStatus(s), false);
});

test('진행 → 완료: 내용이 바뀔 때만 진행 표시를 고치고 결과를 한 번 올린다', async () => {
    const { client } = scripted([
        snap({ status: 'running', currentTurn: 1, progress: 3 }),
        snap({ status: 'running', currentTurn: 1, progress: 3 }),
        snap({ status: 'running', currentTurn: 2, progress: 6 }),
        snap({ status: 'completed', currentTurn: 3, progress: 100, result: '집계 결과입니다.' }),
    ]);
    const s = screen();
    assert.equal(await watchTask(client, 't1', s.ui, opts()), 'completed');
    assert.equal(s.statuses.length, 3); // 턴1, 턴2, 완료 — 같은 내용의 두 번째 조회는 고치지 않는다
    assert.match(s.statuses[0], /1\/32 턴/);
    assert.match(s.statuses[2], /작업 완료/);
    assert.deepEqual(s.finals, ['✅ 작업이 끝났습니다.\n\n집계 결과입니다.']);
});

test('첫 조회에서 이미 끝난 작업도 결과를 한 번만 올린다', async () => {
    const { client, calls } = scripted([snap({ status: 'failed', error: '모델 서버 오류' })]);
    const s = screen();
    assert.equal(await watchTask(client, 't1', s.ui, opts()), 'failed');
    assert.equal(calls(), 1);
    assert.deepEqual(s.finals, ['❌ 작업이 실패했습니다: 모델 서버 오류']);
});

test('승인 대기: 같은 요청이 여러 번 조회돼도 요청당 한 번만 올린다', async () => {
    const a1 = { approvalId: 'a1', taskId: 't1', toolName: 'bash', args: { command: 'ls' } };
    const a2 = { approvalId: 'a2', taskId: 't1', toolName: 'write_file', args: { path: 'a.txt' } };
    const { client } = scripted(
        [snap({ status: 'paused' }), snap({ status: 'paused' }), snap({ status: 'paused' }), snap({ status: 'cancelled' })],
        [[a1], [a1, a2], [a1, a2]],
    );
    const s = screen();
    assert.equal(await watchTask(client, 't1', s.ui, opts()), 'cancelled');
    assert.deepEqual(s.approvals.map((a) => a.approvalId), ['a1', 'a2']);
    assert.deepEqual(s.finals, ['🛑 작업이 취소되었습니다.']);
});

test('조회 실패는 다시 시도하고, 연속 실패가 한도를 넘으면 지켜보기를 끝내고 알린다', async () => {
    let n = 0;
    const flaky = scripted([() => { n += 1; if (n <= 2) throw new Error('ECONNREFUSED'); return snap({ status: 'completed', result: '끝' }); }]);
    const ok = screen();
    assert.equal(await watchTask(flaky.client, 't1', ok.ui, opts({ maxConsecutiveFailures: 3 })), 'completed');

    const down = scripted([() => { throw new Error('ECONNREFUSED'); }]);
    const s = screen();
    assert.equal(await watchTask(down.client, 't1', s.ui, opts({ maxConsecutiveFailures: 3 })), 'unreachable');
    assert.equal(down.calls(), 3);
    assert.equal(s.finals.length, 1);
    assert.match(s.finals[0], /서버에 연결하지 못해/);
});

test('지켜보는 시간이 상한을 넘으면 작업은 두고 지켜보기만 끝낸다', async () => {
    let clock = 0;
    const { client } = scripted([snap({ status: 'running', currentTurn: 1 })]);
    const s = screen();
    const outcome = await watchTask(client, 't1', s.ui, opts({ watchMaxMs: 10_000, now: () => clock, sleep: async () => { clock += 6_000; } }));
    assert.equal(outcome, 'timeout');
    assert.match(s.finals[0], /계속 진행 중/);
});

test('화면 쪽 오류(디스코드 전송 실패)는 지켜보기를 죽이지 않는다', async () => {
    const { client } = scripted([snap({ status: 'running', currentTurn: 1 }), snap({ status: 'completed', result: '끝' })]);
    const finals: string[] = [];
    const ui: WatchUi = {
        updateStatus: async () => { throw new Error('Missing Permissions'); },
        postApproval: async () => undefined,
        postFinal: async (t) => { finals.push(t); },
    };
    assert.equal(await watchTask(client, 't1', ui, opts()), 'completed');
    assert.equal(finals.length, 1);
});

test('진행 표시: 긴 목표는 200자에서 자르고 2000자를 넘지 않는다', () => {
    const text = formatStatus(snap({ status: 'running', currentTurn: 7, progress: 22 }), { ...info, goal: '가'.repeat(5_000) });
    assert.ok(text.length < 400);
    assert.match(text, /7\/32 턴 \(22%\)/);
    assert.match(text, /실행 위치: 서버 격리 환경 · 승인: 전부/);
    assert.match(text, /…/);
});

test('승인 문구: 명령은 그대로, 그 밖의 인자는 JSON 으로, 500자에서 자르고 코드 블록을 깨지 않는다', () => {
    assert.equal(formatApproval({ approvalId: 'a', taskId: 't', toolName: 'bash', args: { command: 'ls -la' } }), '⚠️ 승인이 필요합니다 — bash\n```\nls -la\n```');
    const json = formatApproval({ approvalId: 'a', taskId: 't', toolName: 'write_file', args: { path: 'a.txt', content: 'x' } });
    assert.match(json, /"path": "a.txt"/);
    const long = formatApproval({ approvalId: 'a', taskId: 't', toolName: 'bash', args: { command: '가'.repeat(3_000) } });
    assert.ok(long.length < 600);
    const fence = formatApproval({ approvalId: 'a', taskId: 't', toolName: 'bash', args: { command: 'echo ```hi```' } });
    assert.equal(fence.split('```').length, 3); // 여는 것과 닫는 것 한 쌍뿐
});

test('결과 문구: 산출물 표기는 지우고 안내를 붙인다, 본문이 없으면 그 사실을 적는다', () => {
    assert.equal(formatFinal(snap({ status: 'completed', result: '[[artifact:report]]\n\n요약입니다.' })), '✅ 작업이 끝났습니다.\n\n요약입니다.\n\n📎 산출물은 웹의 작업 화면에서 확인하세요.');
    assert.equal(formatFinal(snap({ status: 'completed', result: null })), '✅ 작업이 끝났습니다.\n\n(결과 본문 없음)');
    assert.equal(formatFinal(snap({ status: 'failed', error: null })), '❌ 작업이 실패했습니다: 사유 없음');
});

test('승인 요청 전송이 실패하면 다음 조회에서 다시 올린다 — 실패한 요청을 올린 것으로 치지 않는다', async () => {
    const a1 = { approvalId: 'a1', taskId: 't1', toolName: 'bash', args: { command: 'ls' } };
    const { client } = scripted([snap({ status: 'paused' }), snap({ status: 'paused' }), snap({ status: 'paused' }), snap({ status: 'cancelled' })], [[a1]]);
    let attempts = 0;
    const posted: string[] = [];
    const ui: WatchUi = {
        updateStatus: async () => undefined,
        postApproval: async (a) => { attempts += 1; if (attempts === 1) throw new Error('rate limited'); posted.push(a.approvalId); },
        postFinal: async () => undefined,
    };
    await watchTask(client, 't1', ui, opts());
    assert.equal(attempts, 2);
    assert.deepEqual(posted, ['a1']);
});

test('결과 전송이 실패하면 짧은 안내를 한 번 더 올린다 — 잘린 결과를 완결된 것처럼 두지 않는다', async () => {
    const { client } = scripted([snap({ status: 'completed', result: '긴 결과' })]);
    const finals: string[] = [];
    let first = true;
    const ui: WatchUi = {
        updateStatus: async () => undefined,
        postApproval: async () => undefined,
        postFinal: async (t) => { if (first) { first = false; throw new Error('send failed'); } finals.push(t); },
    };
    assert.equal(await watchTask(client, 't1', ui, opts()), 'completed');
    assert.equal(finals.length, 1);
    assert.match(finals[0], /결과를 모두 올리지 못했습니다/);
});

test('작업이 서버에서 사라지면(404) 기다리지 않고 바로 알리고 끝낸다', async () => {
    const { client, calls } = scripted([() => { throw new TaskApiError('작업을 찾을 수 없습니다.', 404); }]);
    const s = screen();
    assert.equal(await watchTask(client, 't1', s.ui, opts()), 'gone');
    assert.equal(calls(), 1);
    assert.equal(s.finals.length, 1);
    assert.match(s.finals[0], /찾을 수 없/);
    assert.doesNotMatch(s.finals[0], /연결하지 못/);
});

test('서버가 봇의 인증을 거절하면(401·403) 바로 알리고 끝낸다', async () => {
    for (const status of [401, 403]) {
        const { client, calls } = scripted([() => { throw new TaskApiError('Invalid API key', status); }]);
        const s = screen();
        assert.equal(await watchTask(client, 't1', s.ui, opts()), 'unreachable');
        assert.equal(calls(), 1);
        assert.match(s.finals[0], /인증/);
    }
});

test('진행 표시 전송이 실패하면 내용이 같아도 다음 조회에서 다시 시도한다', async () => {
    const { client } = scripted([
        snap({ status: 'running', currentTurn: 1 }),
        snap({ status: 'running', currentTurn: 1 }),
        snap({ status: 'running', currentTurn: 1 }),
        snap({ status: 'completed', result: '끝' }),
    ]);
    const s = screen();
    let attempts = 0;
    const ui: WatchUi = { ...s.ui, updateStatus: async (t) => { attempts += 1; if (attempts === 1) throw new Error('전송 실패'); s.statuses.push(t); } };
    await watchTask(client, 't1', ui, opts());
    assert.equal(attempts, 3); // 실패 1 + 재시도 성공 1 + 완료 1 — 세 번째 조회(같은 내용, 이미 성공)는 고치지 않는다
});

test('지켜보는 시간이 끝나면 멈추는 방법(/task-cancel)을 함께 알린다', async () => {
    const { client } = scripted([snap({ status: 'running' })]);
    const s = screen();
    assert.equal(await watchTask(client, 't1', s.ui, opts({ watchMaxMs: 0 })), 'timeout');
    assert.match(s.finals[0], /\/task-cancel/);
});

test('completed + continuedByTaskId 면 결과를 올리지 않고 후속 작업을 같은 진행 메시지로 계속 지켜본다', async () => {
    const snapshots: Record<string, TaskSnapshot[]> = {
        a: [snap({ id: 'a', status: 'completed', progress: 100, currentTurn: 5, result: '이어가기', continuedByTaskId: 'b', completionPath: 'continued' })],
        b: [
            snap({ id: 'b', status: 'running', progress: 10, currentTurn: 1 }),
            snap({ id: 'b', status: 'completed', progress: 100, currentTurn: 3, result: '끝', completionPath: 'final_answer' }),
        ],
    };
    const asked: string[] = [];
    const client = {
        getTask: async (id: string) => { asked.push(id); return snapshots[id].length > 1 ? snapshots[id].shift()! : snapshots[id][0]; },
        listPendingApprovals: async () => [],
    };
    const s = screen();
    assert.equal(await watchTask(client, 'a', s.ui, opts({ pollMs: 0 })), 'completed');
    assert.deepEqual(asked, ['a', 'b', 'b']);
    assert.equal(s.finals.length, 1);
    assert.match(s.finals[0], /끝/);
    assert.doesNotMatch(s.finals[0], /이어가기/);
    assert.ok(s.statuses.some((t) => t.includes('세그먼트 2')));
    assert.ok(!s.statuses[0].includes('세그먼트')); // 첫 세그먼트는 머리를 붙이지 않는다
});

test('이어진 작업도 watchMaxMs 는 체인 전체에 적용된다', async () => {
    let t = 0;
    const client = {
        getTask: async (id: string) => snap({ id, status: id === 'a' ? 'completed' : 'running', maxTurns: 1, continuedByTaskId: id === 'a' ? 'b' : null, completionPath: id === 'a' ? 'continued' : null }),
        listPendingApprovals: async () => [],
    };
    const s = screen();
    assert.equal(await watchTask(client, 'a', s.ui, opts({ pollMs: 0, watchMaxMs: 10, sleep: async () => { t += 6; }, now: () => t })), 'timeout');
    assert.equal(s.finals.length, 1);
    assert.match(s.finals[0], /지켜보는 시간이 끝났습니다/);
});
