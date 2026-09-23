/**
 * JobRuntimeRepository SQL(P07/P07b) — 실제 Postgres 의미 검증. **운영 표를 건드리지 않는다**: 한 연결 안에서
 * `orchestrator_jobs` 이름의 TEMP 표를 만들고(pg_temp 가 search_path 앞) 마이그레이션 169 를 그 TEMP 표에 적용한다.
 * TEST_DATABASE_URL → DATABASE_URL, 둘 다 없으면 skip.
 */
import { Pool, type PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { JobRuntimeRepository } from '../../../data/repositories/job-runtime-repo';

const CONN = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

describeOrSkip('JobRuntimeRepository (TEMP orchestrator_jobs)', () => {
    let pool: Pool; let client: PoolClient; let repo: JobRuntimeRepository;
    const intent = (key: string, digest = 'a'.repeat(64), userId = 'u-A') => repo.createIntent({
        userId, capability: 'video.generate', addonId: 'video-runtime', addonVersion: '1.0.0', contractVersion: 1,
        providerId: 'hasa', modelId: 'wan', idempotencyKey: key, requestDigest: digest, credentialRef: 'user:hasa',
    });

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 1 });
        client = await pool.connect();
        await client.query(`CREATE TEMP TABLE orchestrator_jobs (
            id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, capability TEXT NOT NULL, provider_id TEXT NOT NULL, job_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', result_path TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            session_id TEXT, UNIQUE (user_id, provider_id, job_id))`);
        await client.query(`INSERT INTO orchestrator_jobs (user_id, capability, provider_id, job_id, status) VALUES ('u-L', 'video.generate', 'hasa', 'legacy-1', 'pending')`);
        const sql = fs.readFileSync(path.resolve(__dirname, '../../../../../../db/migrations/169_orchestrator_jobs_runtime.sql'), 'utf8');
        await client.query(sql);
        await client.query(sql); // 멱등
        repo = new JobRuntimeRepository(client as unknown as Pool);
    });
    afterAll(async () => { client?.release(true); await pool?.end(); });

    it('legacy 행은 running·addon legacy 로 매핑된다(기존 읽기 경로 status 유지)', async () => {
        const r = await client.query(`SELECT state, status, addon_id FROM orchestrator_jobs WHERE job_id = 'legacy-1'`);
        expect(r.rows[0]).toEqual({ state: 'running', status: 'pending', addon_id: 'legacy' });
    });

    it('같은 key·digest 는 existing, 다른 digest 는 conflict — 행은 하나', async () => {
        expect((await intent('k1')).kind).toBe('created');
        expect((await intent('k1')).kind).toBe('existing');
        expect((await intent('k1', 'b'.repeat(64))).kind).toBe('conflict');
        const n = await client.query(`SELECT count(*)::int AS n FROM orchestrator_jobs WHERE idempotency_key = 'k1'`);
        expect(n.rows[0].n).toBe(1);
    });

    it('T11: 소유자가 아니면 조회·취소 불가 · 종료 상태는 단조', async () => {
        const { job } = await intent('k2');
        expect(await repo.getForOwner('u-B', job.id)).toBeNull();
        expect(await repo.requestCancel('u-B', job.id)).toBeNull();
        expect((await repo.transition(job.id, 'running', { externalJobId: 'ext-2' }))?.state).toBe('running');
        expect((await repo.transition(job.id, 'failed', { errorCode: 'x' }))?.state).toBe('failed');
        expect(await repo.transition(job.id, 'running')).toBeNull();
        expect(await repo.transition(job.id, 'completed')).toBeNull();
    });

    it('T13: 중단된 submitting 은 복구 시 submission_unknown(재제출 없음), 유예 안의 것은 그대로', async () => {
        const { job } = await intent('k3');
        await client.query(`UPDATE orchestrator_jobs SET updated_at = now() - interval '1 hour' WHERE id = $1`, [job.id]);
        const { job: fresh } = await intent('k4');
        expect(await repo.recoverInterruptedSubmissions(60_000)).toBe(1);
        expect((await repo.getById(job.id))?.state).toBe('submission_unknown');
        expect((await repo.getById(fresh.id))?.state).toBe('submitting');
    });

    it('T26: lease 만료 뒤 새 실행자가 token 을 올리면 이전 token 의 완료 쓰기는 거절된다', async () => {
        const { job } = await intent('k5');
        await repo.transition(job.id, 'running', { externalJobId: 'ext-5' });
        const first = await repo.acquireLease(job.id, 'w1', 1);
        expect(first).not.toBeNull();
        expect(await repo.acquireLease(job.id, 'w2', 60_000)).toBeNull(); // 아직 w1 lease — 잠시 뒤 만료
        await new Promise((r) => setTimeout(r, 20));
        const second = await repo.acquireLease(job.id, 'w2', 60_000);
        expect(second!.token).toBe(first!.token + 1);
        expect(await repo.transition(job.id, 'collecting', {}, first!.token)).toBeNull();
        expect((await repo.transition(job.id, 'collecting', { releaseLease: true }, second!.token))?.state).toBe('collecting');
    });

    it('renewLease: 같은 실행자·같은 token 만 lease 를 연장하고, 연장된 lease 는 다른 실행자가 못 잡는다', async () => {
        const { job } = await intent('k7');
        await repo.transition(job.id, 'running', { externalJobId: 'ext-7' });
        const first = await repo.acquireLease(job.id, 'w1', 1);
        expect(await repo.renewLease(job.id, 'w2', first!.token, 60_000)).toBe(false);
        expect(await repo.renewLease(job.id, 'w1', first!.token + 1, 60_000)).toBe(false);
        expect(await repo.renewLease(job.id, 'w1', first!.token, 60_000)).toBe(true);
        await new Promise((r) => setTimeout(r, 20));
        expect(await repo.acquireLease(job.id, 'w2', 60_000)).toBeNull(); // 연장 없었다면 1ms 만료로 잡혔다
    });

    it('수집 소진 job 은 claimDue 가 다시 잡지 않고, resetRetry 는 재시도 횟수를 비운다', async () => {
        await client.query(`UPDATE orchestrator_jobs SET state = 'failed' WHERE state IN ('running','collecting','cancel_requested')`);
        const { job } = await intent('k8');
        await repo.transition(job.id, 'running', { externalJobId: 'ext-8', incrementRetry: true });
        expect((await repo.transition(job.id, 'collecting', { stage: 'collect', resetRetry: true }))?.retryCount).toBe(0);
        await repo.transition(job.id, 'collecting', { stage: 'collect_exhausted', nextPollAt: null, releaseLease: true });
        expect(await repo.claimDue('w1', 60_000, 10)).toEqual([]);
        await repo.transition(job.id, 'collecting', { stage: 'collect_failed' });
        expect((await repo.claimDue('w1', 60_000, 10)).map((x) => x.job.id)).toEqual([job.id]);
    });

    it('T14: 두 실행자의 claimDue 는 같은 job 을 중복 선점하지 않는다', async () => {
        await client.query(`UPDATE orchestrator_jobs SET state = 'failed' WHERE state IN ('running','collecting','cancel_requested')`);
        const { job } = await intent('k6');
        await repo.transition(job.id, 'running', { externalJobId: 'ext-6' });
        const a = await repo.claimDue('w1', 60_000, 10);
        const b = await repo.claimDue('w2', 60_000, 10);
        expect(a.map((x) => x.job.id)).toEqual([job.id]);
        expect(b).toEqual([]);
    });
});
