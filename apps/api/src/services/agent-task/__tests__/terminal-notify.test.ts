/**
 * 종료 알림 유실 재전송 — 작업이 끝났다는 결과는 저장됐는데 알림(화면 이벤트·푸시)을 보내기 전에 프로세스가 죽으면
 * 사용자는 끝난 줄 모른다. 종료 상태를 쓸 때 "알림 보낼 것" 표식을 같은 쓰기로 남기고, 보낸 뒤 지운다.
 * 표식이 남은 종료 작업은 주기 점검이 다시 보낸다.
 */
const emit = jest.fn();
const sendPush = jest.fn(async () => undefined);
jest.mock('../../../utils/event-bus', () => ({ emitAgentTaskProgress: (ev: unknown) => emit(ev) }));
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush }) }));
// 저장소를 만들 수 없는 상황(풀 초기화 실패 등)을 흉내 낸다 — 기본 저장소 경로가 실행 루프를 깨면 안 된다.
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => { throw new Error('pool unavailable'); } }));

import { notifyTaskTerminal, resendMissedTerminalNotifications, type TerminalNotifyRepo } from '../terminal-notify';

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
function repo(rows: Array<Record<string, unknown>> = []): TerminalNotifyRepo & { cleared: string[]; claims: number } {
    const r = {
        cleared: [] as string[],
        claims: 0,
        clearTerminalNotifyPending: jest.fn(async (id: string) => { r.cleared.push(id); }),
        claimPendingTerminalNotifications: jest.fn(async () => { r.claims += 1; return rows as never; }),
    };
    return r;
}

beforeEach(() => { jest.clearAllMocks(); sendPush.mockImplementation(async () => undefined); });

describe('notifyTaskTerminal', () => {
    it('화면 이벤트와 푸시를 보내고, 보낸 뒤 표식을 지운다', async () => {
        const r = repo();
        notifyTaskTerminal({ userId: 'u1', taskId: 't1', goal: '엑셀 만들기', status: 'completed', progress: 100, currentTurn: 3 }, r);
        expect(emit).toHaveBeenCalledWith({ userId: 'u1', taskId: 't1', status: 'completed', progress: 100, currentTurn: 3 });
        expect(sendPush).toHaveBeenCalledWith('u1', expect.objectContaining({ body: '작업이 완료되었습니다: 엑셀 만들기', url: '/agent-tasks' }));
        await flush();
        expect(r.cleared).toEqual(['t1']);
    });

    it('상태별 문구(실패·취소)와 긴 목표 줄임', async () => {
        const long = '가'.repeat(80);
        notifyTaskTerminal({ userId: 'u1', taskId: 't1', goal: long, status: 'failed', progress: 40, currentTurn: 2 }, repo());
        notifyTaskTerminal({ userId: 'u1', taskId: 't2', goal: 'x', status: 'cancelled', progress: 0, currentTurn: 0 }, repo());
        const bodies = sendPush.mock.calls.map((c) => (c as unknown as [string, { body: string }])[1].body);
        expect(bodies[0]).toBe(`작업이 실패되었습니다: ${'가'.repeat(60)}…`);
        expect(bodies[1]).toBe('작업이 취소되었습니다: x');
    });

    it('푸시가 실패해도 표식은 지운다 — 구독이 없거나 만료된 경우를 계속 재시도하지 않는다', async () => {
        sendPush.mockImplementation(async () => { throw new Error('gone'); });
        const r = repo();
        notifyTaskTerminal({ userId: 'u1', taskId: 't1', goal: 'g', status: 'completed', progress: 100, currentTurn: 1 }, r);
        await flush();
        expect(r.cleared).toEqual(['t1']);
    });

    it('저장소를 준비하지 못해도 던지지 않는다 — 알림 실패가 작업의 종료 처리를 깨지 않는다', async () => {
        expect(() => notifyTaskTerminal({ userId: 'u1', taskId: 't1', goal: 'g', status: 'completed', progress: 100, currentTurn: 1 }, undefined, { emit: false })).not.toThrow();
        await flush();
        expect(sendPush).toHaveBeenCalledTimes(1);
    });

    it('푸시 서비스 호출 자체가 던져도 밖으로 새지 않는다', async () => {
        sendPush.mockImplementation(() => { throw new Error('sync boom'); });
        expect(() => notifyTaskTerminal({ userId: 'u1', taskId: 't1', goal: 'g', status: 'completed', progress: 100, currentTurn: 1 }, repo())).not.toThrow();
        await flush();
    });

    it('emit 을 건너뛸 수 있다(호출부가 이미 발행한 경우 중복 방지)', async () => {
        notifyTaskTerminal({ userId: 'u1', taskId: 't1', goal: 'g', status: 'completed', progress: 100, currentTurn: 1 }, repo(), { emit: false });
        expect(emit).not.toHaveBeenCalled();
        expect(sendPush).toHaveBeenCalledTimes(1);
    });
});

describe('notifyTaskTerminal — 푸시 여부를 호출부가 정한다', () => {
    const n = { userId: 'u1', taskId: 't1', goal: 'g', status: 'failed', progress: 40, currentTurn: 2 };

    it('push 가 false 로 풀리면 푸시는 생략하고 표식은 지운다', async () => {
        const r = repo();
        notifyTaskTerminal(n, r, { push: Promise.resolve(false) });
        await flush();
        expect(sendPush).not.toHaveBeenCalled();
        expect(emit).toHaveBeenCalledTimes(1);
        expect(r.cleared).toEqual(['t1']);
    });

    it('push 판단이 실패하면 푸시를 보낸다', async () => {
        notifyTaskTerminal(n, repo(), { push: Promise.reject(new Error('boom')) });
        await flush();
        expect(sendPush).toHaveBeenCalledTimes(1);
    });
});

describe('resendMissedTerminalNotifications', () => {
    it('표식이 남은 종료 작업을 가져와 다시 알린다', async () => {
        const r = repo([
            { id: 't1', user_id: 'u1', goal: '보고서', status: 'completed', progress: 100, current_turn: 4 },
            { id: 't2', user_id: 'u2', goal: '분석', status: 'failed', progress: 30, current_turn: 2 },
        ]);
        const n = await resendMissedTerminalNotifications(r);
        expect(n).toBe(2);
        expect(emit).toHaveBeenCalledWith({ userId: 'u1', taskId: 't1', status: 'completed', progress: 100, currentTurn: 4 });
        expect(emit).toHaveBeenCalledWith({ userId: 'u2', taskId: 't2', status: 'failed', progress: 30, currentTurn: 2 });
        expect(sendPush).toHaveBeenCalledTimes(2);
        // 가져올 때 저장소가 표식을 이미 지웠다(원자적 claim) — 여기서 다시 지우지 않는다
        await flush();
        expect(r.cleared).toEqual([]);
    });

    it('남은 것이 없으면 아무것도 보내지 않는다', async () => {
        expect(await resendMissedTerminalNotifications(repo([]))).toBe(0);
        expect(sendPush).not.toHaveBeenCalled();
    });

    it('소유자가 없는 행은 건너뛴다', async () => {
        const n = await resendMissedTerminalNotifications(repo([{ id: 't1', user_id: null, goal: 'g', status: 'completed', progress: 100, current_turn: 1 }]));
        expect(n).toBe(0);
        expect(sendPush).not.toHaveBeenCalled();
    });

    it('조회가 실패해도 던지지 않는다(다음 주기에 다시 시도)', async () => {
        const r = repo();
        (r.claimPendingTerminalNotifications as jest.Mock).mockRejectedValue(new Error('db down'));
        await expect(resendMissedTerminalNotifications(r)).resolves.toBe(0);
    });
});
