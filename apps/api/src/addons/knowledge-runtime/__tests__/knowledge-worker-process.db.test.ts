/**
 * 별도 worker 프로세스 실 DB 검증 — TEST_DATABASE_URL 없으면 skip. 작업 큐 직렬화 lock 아래에서 돈다.
 * 자식은 Base 진입점(workers/knowledge-worker.ts)을 ts-node(transpile-only)로 띄운다. 임베딩은 가짜 게이트웨이(HTTP).
 *  ① external 모드 — 별도 프로세스가 수집을 끝낸다(heartbeat 행·/health), SIGTERM 은 0 으로 끝나고 heartbeat 행을 지운다
 *  ② SIGKILL 된 실행자의 작업을 다른 프로세스가 lease 만료 뒤 다시 집어 끝낸다(fencing_token 2)
 *  ③ DB 모드가 inprocess 면 떠 있어도 집지 않는다 → external 로 바꾸면 집는다
 *  ④ 실행 중 취소 — 임베딩 응답이 돌아온 뒤 단계 경계에서 멈추고 cancelled(임베딩 쓰기 없음)
 *  ⑤ SIGTERM 은 진행 중 작업을 drain 한 뒤 0 으로 끝난다(작업은 done)
 * jobLeaseMs 를 3초로 줄였다가 되돌린다. 만든 job·space 는 id 로만 지운다.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { applyKnowledgeSchema, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS, lockKnowledgeQueueTests, resetWorkerMode } from './helpers/db-serial';
import {
    activateFakeIndex, assertFullTestSchema, fakeVector, freePort, insertIngestFixture, jobSnapshot, setJobLeaseMs, spawnWorker,
    startFakeGateway, stopWorker, waitFor, workerEnv, type FakeGateway, type WorkerChild,
} from './helpers/worker-process-harness';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
/** 자식 기동(ts-node 트랜스파일 포함)·수집 대기 상한 */
const BOOT_MS = 60_000;
const DONE_MS = 30_000;
const TEST_MS = 150_000;
/** heartbeat 주기 = max(1초, 3초 × 0.4) — 취소 감지를 기다리는 시간은 이보다 넉넉히 */
const CANCEL_OBSERVE_MS = 2_500;

describeOrSkip('knowledge worker 별도 프로세스 (실 DB)', () => {
    const pool = new Pool({ connectionString: CONN, max: 4 });
    const jobIds: string[] = [];
    const spaceIds: string[] = [];
    const children: WorkerChild[] = [];
    let unlock: () => Promise<void>;
    let restoreLease: () => Promise<void>;
    let gateway: FakeGateway;
    let storageDir: string;

    const spawnExternal = (healthPort = 0): WorkerChild => {
        const child = spawnWorker(workerEnv({ databaseUrl: CONN ?? '', gatewayUrl: gateway.url, storageDir, healthPort }));
        children.push(child);
        return child;
    };
    const fixture = async (text: string) => {
        const f = await insertIngestFixture(pool, storageDir, text);
        jobIds.push(f.job);
        spaceIds.push(f.space);
        return f;
    };
    const setMode = (mode: 'inprocess' | 'external') =>
        pool.query(`UPDATE knowledge_worker_mode SET mode = $1, generation = generation + 1, updated_at = NOW() WHERE id = 1`, [mode]);
    const knownWorkers = async () => new Set((await pool.query<{ worker_id: string }>('SELECT worker_id FROM knowledge_worker_heartbeats')).rows.map((r) => r.worker_id));
    /** 새로 뜬 external 소비자의 heartbeat 행 — 기동 완료 신호. 그 worker_id 를 돌려준다 */
    const waitBoot = async (child: WorkerChild, known: Set<string>): Promise<string> => {
        const fresh = await waitFor(
            async () => (await pool.query<{ worker_id: string }>(
                `SELECT worker_id FROM knowledge_worker_heartbeats WHERE mode = 'external' AND last_seen > NOW() - INTERVAL '2 seconds'`,
            )).rows.map((r) => r.worker_id).filter((id) => !known.has(id)),
            (found) => found.length > 0, BOOT_MS, 'external worker heartbeat', child,
        );
        return fresh[0];
    };

    beforeAll(async () => {
        unlock = await lockKnowledgeQueueTests(pool);
        await assertFullTestSchema(pool);
        await applyKnowledgeSchema(pool);
        await resetWorkerMode(pool);
        restoreLease = await setJobLeaseMs(pool, 3_000);
        await activateFakeIndex(pool);
        gateway = await startFakeGateway(fakeVector);
        storageDir = await mkdtemp(join(tmpdir(), 'knowledge-worker-proc-'));
    }, KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS);
    beforeEach(() => {
        gateway.hold(false);
        gateway.releaseAll();
    });
    afterAll(async () => {
        for (const c of children) await stopWorker(c, 'SIGKILL', 5_000);
        gateway.releaseAll();
        await gateway.close();
        if (jobIds.length) await pool.query('DELETE FROM knowledge_ingestion_jobs WHERE id = ANY($1::text[])', [jobIds]);
        if (spaceIds.length) await pool.query('DELETE FROM knowledge_spaces WHERE id = ANY($1::text[])', [spaceIds]);
        await restoreLease();
        await resetWorkerMode(pool);
        await rm(storageDir, { recursive: true, force: true });
        await unlock();
        await pool.end();
    });

    it('external 모드 — 별도 프로세스가 수집을 끝내고(/health·heartbeat), SIGTERM 에 0 으로 끝나며 heartbeat 행을 지운다', async () => {
        await setMode('external');
        const known = await knownWorkers();
        const port = await freePort();
        const child = spawnExternal(port);
        const workerId = await waitBoot(child, known);
        const f = await fixture('별도 프로세스 수집 확인 문서입니다. 두 번째 문장도 있습니다.');
        const done = await waitFor(() => jobSnapshot(pool, f.job), (s) => s.state === 'done', DONE_MS, 'ingest done', child);
        expect(done).toMatchObject({ state: 'done', version_status: 'ready', attempts: 1 });
        expect(done.chunks).toBeGreaterThan(0);
        expect(done.embeddings).toBe(done.chunks);
        expect(gateway.requests()).toBeGreaterThan(0);

        const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as Record<string, unknown>;
        expect(health).toMatchObject({ kind: 'external', dbMode: 'external', workerId, status: 'running' });

        expect(await stopWorker(child, 'SIGTERM', 30_000)).toBe(0);
        expect((await pool.query('SELECT 1 FROM knowledge_worker_heartbeats WHERE worker_id = $1', [workerId])).rowCount).toBe(0);
    }, TEST_MS);

    it('SIGKILL 된 실행자의 작업을 다른 프로세스가 lease 만료 뒤 다시 집어 끝낸다', async () => {
        await setMode('external');
        gateway.hold(true);
        const known = await knownWorkers();
        const a = spawnExternal();
        await waitBoot(a, known);
        const f = await fixture('죽은 실행자 재선점 확인 문서입니다.');
        await waitFor(async () => gateway.pending(), (n) => n >= 1, DONE_MS, 'A 가 임베딩 호출에서 멈춤', a);
        expect(await stopWorker(a, 'SIGKILL', 5_000)).toBeNull();
        gateway.hold(false);
        const b = spawnExternal();
        const done = await waitFor(() => jobSnapshot(pool, f.job), (s) => s.state === 'done', BOOT_MS + DONE_MS, 'B 가 재선점해 완료', b);
        expect(done).toMatchObject({ state: 'done', fencing_token: '2', attempts: 2, version_status: 'ready' });
        expect(await stopWorker(b, 'SIGTERM', 30_000)).toBe(0);
    }, TEST_MS * 2);

    it('DB 모드가 inprocess 면 떠 있어도 집지 않고, external 로 바꾸면 집는다', async () => {
        await setMode('inprocess');
        const known = await knownWorkers();
        const c = spawnExternal();
        await waitBoot(c, known);
        const f = await fixture('모드 불일치 확인 문서입니다.');
        await new Promise((r) => setTimeout(r, 2_000)); // 폴링 200ms × 10회
        expect((await jobSnapshot(pool, f.job)).state).toBe('queued');
        await setMode('external');
        const done = await waitFor(() => jobSnapshot(pool, f.job), (s) => s.state === 'done', DONE_MS, '모드 전환 뒤 완료', c);
        expect(done.attempts).toBe(1);
        expect(await stopWorker(c, 'SIGTERM', 30_000)).toBe(0);
    }, TEST_MS);

    it('실행 중 취소 — 임베딩 응답이 돌아온 뒤 단계 경계에서 멈추고 cancelled(임베딩 쓰기 없음)', async () => {
        await setMode('external');
        gateway.hold(true);
        const known = await knownWorkers();
        const d = spawnExternal();
        await waitBoot(d, known);
        const f = await fixture('취소 확인 문서입니다.');
        await waitFor(async () => gateway.pending(), (n) => n >= 1, DONE_MS, '임베딩 호출에서 멈춤', d);
        await pool.query('UPDATE knowledge_ingestion_jobs SET cancel_requested_at = NOW() WHERE id = $1', [f.job]);
        await new Promise((r) => setTimeout(r, CANCEL_OBSERVE_MS));
        gateway.releaseAll();
        const s = await waitFor(() => jobSnapshot(pool, f.job), (v) => v.state === 'cancelled', DONE_MS, 'cancelled', d);
        expect(s).toMatchObject({ version_status: 'failed', failure_code: 'CANCELLED', embeddings: 0 });
        expect(await stopWorker(d, 'SIGTERM', 30_000)).toBe(0);
    }, TEST_MS);

    it('SIGTERM 은 진행 중 작업을 drain 한 뒤 0 으로 끝난다(작업은 done)', async () => {
        await setMode('external');
        gateway.hold(true);
        const known = await knownWorkers();
        const e = spawnExternal();
        await waitBoot(e, known);
        const f = await fixture('drain 확인 문서입니다.');
        await waitFor(async () => gateway.pending(), (n) => n >= 1, DONE_MS, '임베딩 호출에서 멈춤', e);
        e.proc.kill('SIGTERM');
        await new Promise((r) => setTimeout(r, 500));
        gateway.releaseAll();
        expect(await e.exited).toBe(0);
        expect((await jobSnapshot(pool, f.job)).state).toBe('done');
    }, TEST_MS);
});
