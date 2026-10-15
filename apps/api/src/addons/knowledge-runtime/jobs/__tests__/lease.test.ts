// apps/api/src/addons/knowledge-runtime/jobs/__tests__/lease.test.ts
/**
 * JobLease — claim 때 받은 fencing token 을 확정 쓰기까지 끌고 가는 문맥.
 * markLost → signal abort → throwIfLost 가 LeaseLostError. assertLeaseHeld 는 job 행이 내 token·owner 로 running 인지 FOR SHARE 로 확인한다.
 */
import type { PoolClient } from 'pg';
import { createJobLease, assertLeaseHeld, LeaseLostError } from '../lease';

function fakeClient(rowCount: number) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return { rows: rowCount ? [{ '?column?': 1 }] : [], rowCount }; };
    return { calls, query: query as unknown as Pick<PoolClient, 'query'>['query'] };
}

describe('createJobLease', () => {
    it('처음엔 살아 있고 throwIfLost 는 조용하다', () => {
        const lease = createJobLease({ jobId: 'j1', token: '3', owner: 'host#1#abcd' });
        expect(lease.signal.aborted).toBe(false);
        expect(() => lease.throwIfLost()).not.toThrow();
    });

    it('markLost 뒤에는 signal 이 끊기고 throwIfLost 가 LeaseLostError(jobId·사유 포함)', () => {
        const lease = createJobLease({ jobId: 'j1', token: '3', owner: 'o' });
        lease.markLost('heartbeat 갱신 0행');
        expect(lease.signal.aborted).toBe(true);
        expect(() => lease.throwIfLost()).toThrow(LeaseLostError);
        expect(() => lease.throwIfLost()).toThrow(/j1.*heartbeat 갱신 0행/);
    });

    it('markLost 는 첫 사유만 남긴다(멱등)', () => {
        const lease = createJobLease({ jobId: 'j1', token: '3', owner: 'o' });
        lease.markLost('첫째'); lease.markLost('둘째');
        expect(() => lease.throwIfLost()).toThrow(/첫째/);
    });

    it('renewedAt 은 만든 시각(now)으로 시작하고 touch 로 갱신된다 — heartbeat 오류 지속 시간을 재는 기준', () => {
        const lease = createJobLease({ jobId: 'j1', token: '3', owner: 'o', now: 1_000 });
        expect(lease.renewedAt).toBe(1_000);
        lease.touch(5_000);
        expect(lease.renewedAt).toBe(5_000);
    });
});

describe('assertLeaseHeld', () => {
    it('lease 가 없으면(레거시 호출) 아무것도 하지 않는다', async () => {
        const c = fakeClient(1);
        await expect(assertLeaseHeld(c, undefined)).resolves.toBeUndefined();
        expect(c.calls).toHaveLength(0);
    });

    it('내 token·owner 로 running 인 행이 있으면 통과 — FOR SHARE 로 잠근다', async () => {
        const c = fakeClient(1);
        const lease = createJobLease({ jobId: 'j1', token: '3', owner: 'o' });
        await assertLeaseHeld(c, lease);
        expect(c.calls[0].sql).toMatch(/FROM knowledge_ingestion_jobs/);
        expect(c.calls[0].sql).toMatch(/fencing_token = \$2/);
        expect(c.calls[0].sql).toMatch(/lease_owner = \$3/);
        expect(c.calls[0].sql).toMatch(/state = 'running'/);
        expect(c.calls[0].sql).toMatch(/FOR SHARE/);
        expect(c.calls[0].params).toEqual(['j1', '3', 'o']);
    });

    it('token 은 문자열로 그대로 바인딩한다(BIGINT 정밀도 — Number 변환 없음)', async () => {
        const c = fakeClient(1);
        const big = '9007199254740993'; // 2^53 + 1 — Number 로 바꾸면 깨진다
        await assertLeaseHeld(c, createJobLease({ jobId: 'j1', token: big, owner: 'o' }));
        expect(c.calls[0].params[1]).toBe(big);
    });

    it('행이 없으면(다른 실행자가 집음) lease 를 잃은 것으로 표시하고 LeaseLostError', async () => {
        const c = fakeClient(0);
        const lease = createJobLease({ jobId: 'j1', token: '3', owner: 'o' });
        await expect(assertLeaseHeld(c, lease)).rejects.toThrow(LeaseLostError);
        expect(lease.signal.aborted).toBe(true);
    });

    it('이미 잃은 lease 는 DB 를 묻지 않고 바로 던진다', async () => {
        const c = fakeClient(1);
        const lease = createJobLease({ jobId: 'j1', token: '3', owner: 'o' });
        lease.markLost('x');
        await expect(assertLeaseHeld(c, lease)).rejects.toThrow(LeaseLostError);
        expect(c.calls).toHaveLength(0);
    });
});
