/**
 * 실 DB 테스트 공용 — 작업 큐·모드 행을 만지는 describe 를 한 advisory lock 으로 직렬화하고(jest 워커 2개가
 * 서로의 모드 전환·claim 을 보지 않게), Knowledge 스키마(001 + 004)를 멱등 적용한다.
 * 테스트 전용 파일이다(파일 이름에 .test 가 없어 jest 가 테스트로 돌리지 않는다).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool } from 'pg';

/** 테스트 직렬화 키 — 값은 이 용도의 고유 식별자일 뿐이다(INDEX_PUBLISH_LOCK_KEY 와 겹치지 않게 둔다) */
export const KNOWLEDGE_DB_TEST_LOCK_KEY = 7_041_902_500;

// __tests__/helpers → apps/api/addons/builtin/knowledge-runtime/migrations
const MIGRATIONS = resolve(__dirname, '../../../../../addons/builtin/knowledge-runtime/migrations');

/** lock 대기 상한(ms) — 다른 jest 워커의 실 DB 파일이 쥐고 있으면 여기까지 기다린다(가장 긴 파일보다 넉넉히) */
export const KNOWLEDGE_DB_TEST_LOCK_WAIT_MS = 150_000;
/** lock 을 잡는 beforeAll 의 jest 시간 상한 — lock 대기 상한보다 길어야 기본 hook 시간 초과 대신 분명한 lock 오류로 끝난다 */
export const KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS = KNOWLEDGE_DB_TEST_LOCK_WAIT_MS + 30_000;

/** 세션 advisory lock 을 잡고, 놓는 함수를 돌려준다 — beforeAll(시간 상한 KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS)에서 잡고 afterAll 에서 놓는다 */
export async function lockKnowledgeQueueTests(pool: Pool): Promise<() => Promise<void>> {
    const client = await pool.connect();
    try {
        await client.query("SELECT set_config('lock_timeout', $1, false)", [String(KNOWLEDGE_DB_TEST_LOCK_WAIT_MS)]);
        await client.query('SELECT pg_advisory_lock($1)', [KNOWLEDGE_DB_TEST_LOCK_KEY]);
        await client.query('RESET lock_timeout');
    } catch (err) {
        client.release();
        throw new Error(
            `Knowledge 실 DB 테스트 lock 을 ${KNOWLEDGE_DB_TEST_LOCK_WAIT_MS}ms 안에 잡지 못했다 — 다른 jest 워커가 쥐고 있다(--runInBand 로 돌린다): ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    return async () => {
        try {
            await client.query('SELECT pg_advisory_unlock($1)', [KNOWLEDGE_DB_TEST_LOCK_KEY]);
        } finally {
            client.release();
        }
    };
}

/**
 * 001 + 004 를 그대로 적용하고 004 를 migration_versions 에 기록한다(별도 worker 의 스키마 확인용). 전부 멱등.
 * 002·003 은 users 표 FK 가 있어 최소 테스트 DB 에서 실패할 수 있으므로 적용하지 않는다(이 테스트들은 그 열을 쓰지 않는다).
 */
export async function applyKnowledgeSchema(pool: Pool): Promise<void> {
    await pool.query('CREATE TABLE IF NOT EXISTS conversation_sessions (id TEXT PRIMARY KEY)');
    await pool.query(readFileSync(resolve(MIGRATIONS, '001_knowledge_spaces.sql'), 'utf8'));
    await pool.query(readFileSync(resolve(MIGRATIONS, '004_jobs_actor_cancel_mode.sql'), 'utf8'));
    await pool.query(`
        CREATE TABLE IF NOT EXISTS migration_versions (
            id SERIAL PRIMARY KEY,
            version VARCHAR(255) NOT NULL UNIQUE,
            filename VARCHAR(255) NOT NULL,
            applied_at TIMESTAMPTZ DEFAULT NOW(),
            checksum VARCHAR(64)
        )`);
    await pool.query(
        `INSERT INTO migration_versions (version, filename) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
        ['addon:knowledge-runtime:004', '004_jobs_actor_cancel_mode.sql'],
    );
}

/** 모드를 기본(inprocess)으로 되돌린다 — 모드를 바꾼 테스트의 afterAll·각 테스트 시작에서 부른다 */
export async function resetWorkerMode(pool: Pool): Promise<void> {
    await pool.query(`UPDATE knowledge_worker_mode SET mode = 'inprocess', updated_at = NOW() WHERE id = 1`);
}
