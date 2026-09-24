/**
 * Job Runtime 포트(P07) — 제출 의도 선저장·중복 제출 방지·응답 유실(T13)·소유자 scope(T11)·상태 전이표.
 */
import { canTransition, legacyStatusFor, sourcesFor, TERMINAL_JOB_STATES } from '../../capability-contract/job-state';
import { scopedJobRuntime, isDefinitelyNotSubmitted } from '../job-runtime';
import { HttpCallError } from '../../services/orchestrator/http-call';
import type { JobRecord, JobRuntimeRepository } from '../../data/repositories/job-runtime-repo';
import type { ApprovedInvocationHandle } from '../../capability-contract/admission';

const handle: ApprovedInvocationHandle = { taskId: 't1', capability: 'video.generate', userId: 'A', sessionId: 's1', owner: { addonId: 'video-runtime', addonVersion: '1.0.0', source: 'builtin' }, registryRevision: 1, stateRevision: 1, issuedAt: 1000, deadline: 1e15 };
const job = (): JobRecord => ({ id: '1', userId: 'A', state: 'submitting', requestDigest: 'd' } as JobRecord);

function fakeRepo(intent: 'created' | 'existing' | 'conflict' = 'created') {
    const calls: Array<[string, string, unknown]> = [];
    const r = {
        createIntent: jest.fn(async () => ({ kind: intent, job: job() })),
        transition: jest.fn(async (id: string, to: string, patch: unknown) => { calls.push([id, to, patch]); return { ...job(), state: to } as JobRecord; }),
        getForOwner: jest.fn(async (userId: string, id: string) => (userId === 'A' && id === '1' ? job() : null)),
    };
    return { r: r as unknown as JobRuntimeRepository, calls, raw: r };
}

describe('job-state 전이표', () => {
    it('종료 상태는 단조 — 어디로도 가지 않는다', () => {
        for (const s of TERMINAL_JOB_STATES) for (const to of ['running', 'collecting', 'failed', 'completed'] as const) expect(canTransition(s, to)).toBe(false);
    });
    it('취소 요청 중 provider 완료는 completed 로(성공을 취소로 덮지 않는다) · submission_unknown 은 자동으로 submitting 으로 돌아가지 않는다', () => {
        expect(canTransition('cancel_requested', 'completed')).toBe(true);
        expect(canTransition('submission_unknown', 'submitting')).toBe(false);
        expect(sourcesFor('submission_unknown')).toEqual(['submitting']);
        expect(legacyStatusFor('cancelled')).toBe('failed');
        expect(legacyStatusFor('collecting')).toBe('pending');
    });
});

describe('scopedJobRuntime.submit', () => {
    it('의도 저장 → send → running(외부 id 연결)', async () => {
        const { r, calls } = fakeRepo();
        const send = jest.fn(async () => ({ externalJobId: 'ext-1' }));
        const out = await scopedJobRuntime(handle, { repo: () => r }).submit({ providerId: 'hasa', modelId: 'wan', credentialRef: 'user:hasa', request: { prompt: 'x' } }, send);
        expect(out).toMatchObject({ kind: 'submitted', externalJobId: 'ext-1', persisted: true });
        expect(send).toHaveBeenCalledTimes(1);
        expect(calls[0]).toEqual(['1', 'running', { externalJobId: 'ext-1', stage: 'submitted', nextPollAt: null }]);
    });

    it('같은 key 가 이미 있으면 새 제출 없이 existing, digest 가 다르면 conflict', async () => {
        for (const kind of ['existing', 'conflict'] as const) {
            const { r } = fakeRepo(kind);
            const send = jest.fn(async () => ({ externalJobId: 'x' }));
            expect((await scopedJobRuntime(handle, { repo: () => r }).submit({ providerId: 'p', modelId: 'm', credentialRef: 'c', request: {} }, send)).kind).toBe(kind);
            expect(send).not.toHaveBeenCalled();
        }
    });

    it('T13: 응답 유실(연결 끊김·타임아웃)은 submission_unknown — 재제출하지 않는다', async () => {
        const { r, calls } = fakeRepo();
        const send = jest.fn(async () => { throw new HttpCallError('취소됨', undefined, 'aborted'); });
        const out = await scopedJobRuntime(handle, { repo: () => r }).submit({ providerId: 'p', modelId: 'm', credentialRef: 'c', request: {} }, send);
        expect(out.kind).toBe('unknown');
        expect(send).toHaveBeenCalledTimes(1);
        expect(calls[0][1]).toBe('submission_unknown');
    });

    it('provider 가 응답으로 거절(HTTP 4xx)하면 생성이 없었으므로 failed', async () => {
        const { r, calls } = fakeRepo();
        const out = await scopedJobRuntime(handle, { repo: () => r }).submit({ providerId: 'p', modelId: 'm', credentialRef: 'c', request: {} }, async () => { throw new HttpCallError('HTTP 400 bad', 400); });
        expect(out.kind).toBe('rejected');
        expect(calls[0][1]).toBe('failed');
        expect(isDefinitelyNotSubmitted(new Error('socket hang up'))).toBe(false);
    });

    it('T11: 다른 사용자의 job 은 조회·전이 불가', async () => {
        const { r, raw } = fakeRepo();
        const mine = scopedJobRuntime(handle, { repo: () => r });
        const theirs = scopedJobRuntime({ ...handle, userId: 'B' }, { repo: () => r });
        expect(await mine.get('1')).not.toBeNull();
        expect(await theirs.get('1')).toBeNull();
        expect(await theirs.advance('1', 'cancel_requested')).toBeNull();
        expect(raw.transition).not.toHaveBeenCalled();
    });
});
