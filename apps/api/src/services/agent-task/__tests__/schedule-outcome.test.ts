/**
 * 예약 실행 결과 반영 — 같은 오류 서명은 한 번만 알리고, 연속 N회 실패면 예약을 끄고, 성공하면 카운터를 푼다.
 */
const sendPush = jest.fn(async (_userId: string, _p: { body: string }) => undefined);
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush: (u: string, p: { body: string }) => sendPush(u, p) }) }));

import { failureSignature, decideScheduleOutcome, applyScheduleOutcome, type ScheduleOutcomeRepo } from '../schedule-outcome';

const CFG = { disableAfter: 3 };
const state = (over: Record<string, unknown> = {}) => ({ consecutiveFailures: 0, lastFailureSignature: null as string | null, ...over });

describe('failureSignature', () => {
    it('숫자·식별자가 달라도 같은 종류의 오류는 같은 서명이 된다', () => {
        expect(failureSignature('500 Internal error req_123456')).toBe(failureSignature('500 Internal error req_987'));
        expect(failureSignature('goal_incomplete')).not.toBe(failureSignature('max_turns_exhausted'));
    });
});

describe('decideScheduleOutcome', () => {
    it('완료면 카운터를 풀고 알림은 그대로 보낸다', () => {
        expect(decideScheduleOutcome(state({ consecutiveFailures: 2, lastFailureSignature: 'x' }), { status: 'completed' }, CFG))
            .toEqual({ kind: 'success', push: true });
    });

    it('첫 실패는 알리고, 같은 서명의 다음 실패는 알리지 않는다', () => {
        const first = decideScheduleOutcome(state(), { status: 'failed', error: 'goal_incomplete' }, CFG);
        expect(first).toMatchObject({ kind: 'failure', push: true, failures: 1, disable: false });
        const sig = (first as { signature: string }).signature;
        const second = decideScheduleOutcome(state({ consecutiveFailures: 1, lastFailureSignature: sig }), { status: 'failed', error: 'goal_incomplete' }, CFG);
        expect(second).toMatchObject({ kind: 'failure', push: false, failures: 2, disable: false });
    });

    it('서명이 바뀌면 다시 알린다', () => {
        const d = decideScheduleOutcome(state({ consecutiveFailures: 1, lastFailureSignature: failureSignature('goal_incomplete') }), { status: 'failed', error: 'timeout' }, CFG);
        expect(d).toMatchObject({ kind: 'failure', push: true, failures: 2 });
    });

    it('연속 N회째 실패면 예약을 끈다', () => {
        const d = decideScheduleOutcome(state({ consecutiveFailures: 2, lastFailureSignature: failureSignature('timeout') }), { status: 'failed', error: 'timeout' }, CFG);
        expect(d).toMatchObject({ kind: 'failure', failures: 3, disable: true });
    });

    it('취소와 서버 재시작 중단은 실패로 세지 않는다', () => {
        expect(decideScheduleOutcome(state(), { status: 'cancelled', error: 'aborted' }, CFG)).toEqual({ kind: 'ignore', push: true });
        expect(decideScheduleOutcome(state(), { status: 'failed', error: 'server restarted' }, CFG)).toEqual({ kind: 'ignore', push: true });
    });
});

describe('applyScheduleOutcome', () => {
    const row = (over: Record<string, unknown> = {}) => ({ id: 's1', user_id: 'u1', goal: '일일 보고', consecutive_failures: 0, last_failure_signature: null, ...over });
    const repo = (r: Record<string, unknown> | undefined): jest.Mocked<ScheduleOutcomeRepo> => ({
        get: jest.fn(async () => r),
        recordRunSuccess: jest.fn(async () => undefined),
        recordRunFailure: jest.fn(async () => undefined),
    } as unknown as jest.Mocked<ScheduleOutcomeRepo>);
    beforeEach(() => sendPush.mockClear());

    it('완료면 예약의 실패 기록을 지운다', async () => {
        const r = repo(row({ consecutive_failures: 2 }));
        await expect(applyScheduleOutcome(r, 's1', { status: 'completed' }, CFG)).resolves.toBe(true);
        expect(r.recordRunSuccess).toHaveBeenCalledWith('s1');
        expect(r.recordRunFailure).not.toHaveBeenCalled();
    });

    it('같은 서명의 실패는 횟수만 올리고 종료 알림을 막는다', async () => {
        const r = repo(row({ consecutive_failures: 1, last_failure_signature: failureSignature('goal_incomplete') }));
        await expect(applyScheduleOutcome(r, 's1', { status: 'failed', error: 'goal_incomplete' }, CFG)).resolves.toBe(false);
        expect(r.recordRunFailure).toHaveBeenCalledWith('s1', expect.objectContaining({ failures: 2, disable: false }));
        expect(sendPush).not.toHaveBeenCalled();
    });

    it('N회째 실패면 사유와 함께 예약을 끄고 꺼졌다고 따로 알린다', async () => {
        const r = repo(row({ consecutive_failures: 2, last_failure_signature: failureSignature('timeout') }));
        await applyScheduleOutcome(r, 's1', { status: 'failed', error: 'timeout' }, CFG);
        const arg = r.recordRunFailure.mock.calls[0][1];
        expect(arg).toMatchObject({ failures: 3, disable: true });
        expect(arg.reason).toContain('3');
        expect(sendPush).toHaveBeenCalledTimes(1);
        expect(sendPush.mock.calls[0][1].body).toContain('일일 보고');
    });

    it('예약을 못 읽거나 저장이 실패해도 던지지 않고 알림은 보낸다', async () => {
        await expect(applyScheduleOutcome(repo(undefined), 's1', { status: 'failed', error: 'timeout' }, CFG)).resolves.toBe(true);
        const r = repo(row());
        r.recordRunFailure.mockRejectedValue(new Error('db down'));
        await expect(applyScheduleOutcome(r, 's1', { status: 'failed', error: 'timeout' }, CFG)).resolves.toBe(true);
    });
});

describe('모델 미도달 — 보류와 재실행', () => {
    const NOW = Date.parse('2026-10-04T01:00:00Z');
    const MIN = 60_000;
    const RCFG = { disableAfter: 3, retryDelaysMs: [5 * MIN, 15 * MIN, 30 * MIN], nowMs: NOW };
    const st = (over: Record<string, unknown> = {}) => ({ consecutiveFailures: 0, lastFailureSignature: null, retryAttempt: 0, nextRunAtMs: NOW + 24 * 60 * MIN, ...over });
    const unreachable = { status: 'failed', error: 'Connection error.', totalTokens: 0 };

    it('모델 호출 0회 + 일시 오류면 실패로 세지 않고 5분 뒤 다시 돌린다(알림 없음)', () => {
        expect(decideScheduleOutcome(st(), unreachable, RCFG)).toEqual({ kind: 'retry', push: false, retryAtMs: NOW + 5 * MIN, attempt: 1 });
        expect(decideScheduleOutcome(st({ retryAttempt: 1 }), { ...unreachable, error: '503 Service Unavailable' }, RCFG))
            .toEqual({ kind: 'retry', push: false, retryAtMs: NOW + 15 * MIN, attempt: 2 });
        expect(decideScheduleOutcome(st({ retryAttempt: 2 }), unreachable, RCFG)).toMatchObject({ kind: 'retry', retryAtMs: NOW + 30 * MIN, attempt: 3 });
    });

    it('3회를 다 쓰면 실패로 센다', () => {
        expect(decideScheduleOutcome(st({ retryAttempt: 3 }), unreachable, RCFG)).toMatchObject({ kind: 'failure', failures: 1 });
    });

    it('다음 정규 발화와 겹치면 재실행하지 않는다', () => {
        expect(decideScheduleOutcome(st({ nextRunAtMs: NOW + 5 * MIN }), unreachable, RCFG)).toMatchObject({ kind: 'failure' });
    });

    it('모델이 한 번이라도 답했거나 일시 오류가 아니면 재실행하지 않는다', () => {
        expect(decideScheduleOutcome(st(), { ...unreachable, totalTokens: 1200 }, RCFG)).toMatchObject({ kind: 'failure' });
        expect(decideScheduleOutcome(st(), { status: 'failed', error: '400 Bad Request', totalTokens: 0 }, RCFG)).toMatchObject({ kind: 'failure' });
        expect(decideScheduleOutcome(st(), { status: 'failed', error: 'goal_incomplete', totalTokens: 0 }, RCFG)).toMatchObject({ kind: 'failure' });
    });

    it('재실행 설정이 없으면(꺼짐) 종전대로 실패로 센다', () => {
        expect(decideScheduleOutcome(st(), unreachable, { disableAfter: 3 })).toMatchObject({ kind: 'failure' });
    });

    it('재실행을 예약에 기록하고 종료 알림을 막는다', async () => {
        const r = {
            get: jest.fn(async () => ({ id: 's1', user_id: 'u1', goal: 'g', consecutive_failures: 0, retry_attempt: 0, next_run_at: new Date(NOW + 60 * MIN).toISOString() })),
            recordRunSuccess: jest.fn(), recordRunFailure: jest.fn(), scheduleRetry: jest.fn(async () => undefined),
        } as unknown as jest.Mocked<ScheduleOutcomeRepo>;
        await expect(applyScheduleOutcome(r, 's1', unreachable, RCFG)).resolves.toBe(false);
        expect(r.scheduleRetry).toHaveBeenCalledWith('s1', NOW + 5 * MIN, 1);
        expect(r.recordRunFailure).not.toHaveBeenCalled();
    });
});

describe('"보고할 것 없음" 선언', () => {
    const SCFG = { disableAfter: 3, silentMarker: '[NOTHING_TO_REPORT]' };
    const st = { consecutiveFailures: 1, lastFailureSignature: null };

    it('완료된 최종 응답이 표식이면 종료 알림을 생략한다(성공으로는 센다)', () => {
        expect(decideScheduleOutcome(st, { status: 'completed', result: ' [NOTHING_TO_REPORT]\n' }, SCFG)).toEqual({ kind: 'success', push: false });
        expect(decideScheduleOutcome(st, { status: 'completed', result: '[NOTHING_TO_REPORT] 변동 없음' }, SCFG)).toEqual({ kind: 'success', push: false });
    });

    it('완료 판정이 표식 응답을 미달성으로 돌려도 판정은 두고 알림만 생략한다 — 실패로 세지도 않는다', () => {
        expect(decideScheduleOutcome(st, { status: 'failed', error: 'goal_incomplete', result: '[NOTHING_TO_REPORT]' }, SCFG)).toEqual({ kind: 'ignore', push: false });
    });

    it('표식이 본문 중간에 있으면 보통 응답이다', () => {
        expect(decideScheduleOutcome(st, { status: 'completed', result: '보고서입니다. [NOTHING_TO_REPORT]' }, SCFG)).toEqual({ kind: 'success', push: true });
    });

    it('꺼져 있으면(표식 설정 없음) 표식 응답도 알린다', () => {
        expect(decideScheduleOutcome(st, { status: 'completed', result: '[NOTHING_TO_REPORT]' }, { disableAfter: 3 })).toEqual({ kind: 'success', push: true });
    });
});
