/**
 * Job poller(P07b) — fencing·단조 종료·수집 실패와 생성 실패 구분·취소 미지원·driver 없음·배정 변경·승인 차단.
 */
import { advanceJob, runPollerTick, type PollerDeps } from '../job-poller';
import type { JobRecord } from '../../data/repositories/job-runtime-repo';
import type { JobDriver } from '../../runtime-ports/job-runtime';

const baseJob = (over: Partial<JobRecord> = {}): JobRecord => ({
    id: '7', userId: 'A', orgId: null, sessionId: 's', capability: 'video.generate', addonId: 'video-runtime', addonVersion: '1.0.0', contractVersion: 1,
    providerId: 'hasa', modelId: 'wan', externalJobId: 'ext-7', idempotencyKey: 'k', requestDigest: 'd', state: 'running', stage: null, progress: null,
    retryCount: 0, nextPollAt: null, deadline: null, leaseOwner: 'w1', leaseExpiresAt: null, fencingToken: 3, artifactIds: [], resultPath: null,
    errorCode: null, traceId: null, credentialRef: 'user:hasa', createdAt: new Date(0), updatedAt: new Date(0), ...over,
});

function deps(driver: Partial<JobDriver> | null, over: Partial<PollerDeps> = {}) {
    const writes: Array<{ to: string; patch: Record<string, unknown>; token?: number }> = [];
    const d: PollerDeps = {
        owner: 'w1',
        repo: {
            claimDue: async () => [],
            transition: async (_id, to, patch, token) => { writes.push({ to, patch: (patch ?? {}) as Record<string, unknown>, token }); return token === 3 ? ({ ...baseJob(), state: to } as JobRecord) : null; },
        },
        invokerFor: async () => ({ describe: () => { throw new Error(); }, invokeJson: async () => ({}) as never, invokeBinary: async () => ({ bytes: Buffer.alloc(0), contentType: '' }), download: async () => ({ bytes: Buffer.alloc(0), contentType: '' }) }),
        driverFor: () => (driver ? { driver: { poll: async () => ({ status: 'running' }), collect: async () => ({ bytes: Buffer.from('v'), ext: 'mp4', mime: 'video/mp4' }), ...driver } as JobDriver, addonId: 'video-runtime', addonVersion: '1.0.0' } : null),
        admit: async () => ({ ok: true }),
        saveResult: async () => ({ id: '99', urlPath: '/generated/video-1.mp4' }),
        now: () => 1_000_000,
        ...over,
    };
    return { d, writes };
}

describe('advanceJob', () => {
    it('진행 중이면 running 유지 + 진행률 + 다음 폴링 시각, 모든 쓰기는 받은 token 조건부', async () => {
        const { d, writes } = deps({ poll: async () => ({ status: 'running', progress: 40 }) });
        expect(await advanceJob(baseJob(), 3, d)).toBe('running');
        expect(writes[0]).toMatchObject({ to: 'running', token: 3, patch: { progress: 40, releaseLease: true } });
    });

    it('완료 → collecting → 결과 저장 → completed(result_path·artifact)', async () => {
        const { d, writes } = deps({ poll: async () => ({ status: 'done' }) });
        expect(await advanceJob(baseJob(), 3, d)).toBe('completed');
        expect(writes.map((w) => w.to)).toEqual(['collecting', 'completed']);
        expect(writes[1].patch).toMatchObject({ resultPath: '/generated/video-1.mp4', artifactIds: ['99'] });
    });

    it('T26: lease 만료 뒤 돌아온 이전 실행자(token 불일치)의 완료 쓰기는 거절 — 덮어쓰기 0', async () => {
        const { d } = deps({ poll: async () => ({ status: 'done' }) });
        expect(await advanceJob(baseJob(), 2, d)).toBe('fenced');
    });

    it('T12: 다운로드 실패는 생성 실패가 아니다 — collecting 유지·재시도 카운트, 재제출 없음', async () => {
        const poll = jest.fn(async () => ({ status: 'done' as const }));
        const { d, writes } = deps({ poll, collect: async () => { throw new Error('terminated'); } });
        expect(await advanceJob(baseJob(), 3, d)).toBe('collect_failed');
        expect(writes.at(-1)).toMatchObject({ to: 'collecting', patch: { errorCode: 'collect_failed', incrementRetry: true } });
        // 다음 주기엔 collecting 에서 곧장 수집만 — provider 에 상태를 다시 묻지도 않는다
        await advanceJob(baseJob({ state: 'collecting', retryCount: 1 }), 3, d);
        expect(poll).toHaveBeenCalledTimes(1);
    });

    it('취소 요청 + driver 취소 미지원이면 running 으로 되돌리고 poll 을 이어 간다 · 취소 지원이면 cancelled', async () => {
        const a = deps({ poll: async () => ({ status: 'running' }) });
        expect(await advanceJob(baseJob({ state: 'cancel_requested' }), 3, a.d)).toBe('running');
        expect(a.writes[0]).toMatchObject({ to: 'running', patch: { stage: 'cancel_unsupported' } });
        const b = deps({ cancel: async () => true });
        expect(await advanceJob(baseJob({ state: 'cancel_requested' }), 3, b.d)).toBe('cancelled');
    });

    it('driver 가 없거나 소유 add-on 이 바뀌면 blocked_runtime — 임의 provider 로 재제출하지 않는다', async () => {
        expect(await advanceJob(baseJob(), 3, deps(null).d)).toBe('blocked_runtime');
        const { d } = deps({});
        expect(await advanceJob(baseJob({ addonId: 'other-video' }), 3, d)).toBe('blocked_runtime');
    });

    it('배정 provider 가 바뀌었거나 키가 없으면 reauth_required 로 미룬다(원래 provider identity 유지)', async () => {
        const { d, writes } = deps({}, { invokerFor: async () => '배정 provider 변경(hasa → openrouter)' });
        expect(await advanceJob(baseJob(), 3, d)).toBe('reauth_required');
        expect(writes[0]).toMatchObject({ to: 'running', patch: { stage: 'reauth_required' } });
    });

    it('승인 차단(add-on 중지·상태 불명)이면 네트워크 호출 없이 상태 보존', async () => {
        const poll = jest.fn();
        const invokerFor = jest.fn();
        const { d } = deps({ poll }, { admit: async () => ({ ok: false }), invokerFor });
        expect(await advanceJob(baseJob(), 3, d)).toBe('admission_blocked');
        expect(poll).not.toHaveBeenCalled();
        expect(invokerFor).not.toHaveBeenCalled();
    });

    it('기한 초과는 deadline_exceeded 로 실패(별도 오류 코드)', async () => {
        const { d, writes } = deps({});
        expect(await advanceJob(baseJob({ deadline: new Date(10) }), 3, d)).toBe('deadline_exceeded');
        expect(writes[0]).toMatchObject({ to: 'failed', patch: { errorCode: 'deadline_exceeded' } });
    });

    it('runPollerTick 은 선점한 job 만 진행한다', async () => {
        const { d } = deps({ poll: async () => ({ status: 'running' }) }, {});
        d.repo.claimDue = async () => [{ job: baseJob(), token: 3 }];
        expect(await runPollerTick(d)).toEqual(['running']);
    });
});
