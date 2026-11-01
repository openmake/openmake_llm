/**
 * 실 DB 테스트 공용 — 작업 큐·모드 행을 만지는 describe 를 한 advisory lock 으로 직렬화하고(jest 워커 2개가
 * 서로의 모드 전환·claim 을 보지 않게), Knowledge 스키마(001 + 004 + 006)를 멱등 적용한다.
 * 테스트 전용 파일이다(파일 이름에 .test 가 없어 jest 가 테스트로 돌리지 않는다).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, type Pool } from 'pg';

/** 테스트 직렬화 키 — 값은 이 용도의 고유 식별자일 뿐이다(INDEX_PUBLISH_LOCK_KEY 와 겹치지 않게 둔다) */
export const KNOWLEDGE_DB_TEST_LOCK_KEY = 7_041_902_500;

// __tests__/helpers → apps/api/addons/builtin/knowledge-runtime/migrations
const MIGRATIONS = resolve(__dirname, '../../../../../addons/builtin/knowledge-runtime/migrations');

/** lock 대기 상한(ms) — 다른 jest 워커의 실 DB 파일이 쥐고 있으면 여기까지 기다린다(가장 긴 파일보다 넉넉히) */
export const KNOWLEDGE_DB_TEST_LOCK_WAIT_MS = 150_000;
/** lock 을 잡는 beforeAll 의 jest 시간 상한 — lock 대기 상한보다 길어야 기본 hook 시간 초과 대신 분명한 lock 오류로 끝난다 */
export const KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS = KNOWLEDGE_DB_TEST_LOCK_WAIT_MS + 30_000;

/** 아직 놓지 않은 lock 의 해제 함수 — 스위트 afterAll 이 정리 중에 실패해 unlock 에 닿지 못해도 아래 안전망이 놓는다 */
const heldLocks = new Set<() => Promise<void>>();
// 파일 최상위(root) afterAll — 스위트 describe 의 afterAll 뒤에 돈다. 남은 lock 을 놓아 다음 파일이 lock 대기로 연쇄 실패하지 않게 한다
afterAll(async () => {
    for (const release of [...heldLocks]) await release();
});

/**
 * 세션 advisory lock 을 잡고, 놓는 함수를 돌려준다 — beforeAll(시간 상한 KNOWLEDGE_DB_LOCK_HOOK_TIMEOUT_MS)에서 잡고 afterAll 에서 놓는다.
 * lock 은 풀 밖 전용 연결이 쥔다 — 풀 클라이언트로 쥐면 해제 전 pool.end() 가 그 클라이언트를 기다리며 멈춘다.
 * 해제 함수는 여러 번 불러도 안전하다(연결을 닫으면 세션 lock 도 풀린다).
 */
export async function lockKnowledgeQueueTests(pool: Pool): Promise<() => Promise<void>> {
    const client = new Client(pool.options);
    await client.connect();
    try {
        await client.query("SELECT set_config('lock_timeout', $1, false)", [String(KNOWLEDGE_DB_TEST_LOCK_WAIT_MS)]);
        await client.query('SELECT pg_advisory_lock($1)', [KNOWLEDGE_DB_TEST_LOCK_KEY]);
        await client.query('RESET lock_timeout');
    } catch (err) {
        await client.end().catch(() => undefined);
        throw new Error(
            `Knowledge 실 DB 테스트 lock 을 ${KNOWLEDGE_DB_TEST_LOCK_WAIT_MS}ms 안에 잡지 못했다 — 다른 jest 워커가 쥐고 있다(--runInBand 로 돌린다): ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    const release = async (): Promise<void> => {
        if (!heldLocks.delete(release)) return;
        try {
            await client.query('SELECT pg_advisory_unlock($1)', [KNOWLEDGE_DB_TEST_LOCK_KEY]);
        } finally {
            await client.end();
        }
    };
    heldLocks.add(release);
    return release;
}

/** 이 헬퍼가 적용하고 migration_versions 에 기록하는 add-on 마이그레이션(순서대로) */
const APPLIED_MIGRATIONS: ReadonlyArray<readonly [version: string, filename: string]> = [
    ['addon:knowledge-runtime:004', '004_jobs_actor_cancel_mode.sql'],
    ['addon:knowledge-runtime:006', '006_space_embedding_index.sql'],
];

/**
 * 001 + 004 + 006 을 그대로 적용하고 004·006 을 migration_versions 에 기록한다(별도 worker 의 스키마 확인용). 전부 멱등.
 * 002·003 은 users 표 FK 가 있어 최소 테스트 DB 에서 실패할 수 있으므로 적용하지 않는다(이 테스트들은 그 열을 쓰지 않는다).
 */
export async function applyKnowledgeSchema(pool: Pool): Promise<void> {
    await pool.query('CREATE TABLE IF NOT EXISTS conversation_sessions (id TEXT PRIMARY KEY)');
    await pool.query(readFileSync(resolve(MIGRATIONS, '001_knowledge_spaces.sql'), 'utf8'));
    for (const [, filename] of APPLIED_MIGRATIONS) await pool.query(readFileSync(resolve(MIGRATIONS, filename), 'utf8'));
    await pool.query(`
        CREATE TABLE IF NOT EXISTS migration_versions (
            id SERIAL PRIMARY KEY,
            version VARCHAR(255) NOT NULL UNIQUE,
            filename VARCHAR(255) NOT NULL,
            applied_at TIMESTAMPTZ DEFAULT NOW(),
            checksum VARCHAR(64)
        )`);
    for (const [version, filename] of APPLIED_MIGRATIONS) {
        await pool.query(
            `INSERT INTO migration_versions (version, filename) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
            [version, filename],
        );
    }
}

/** 모드를 기본(inprocess)으로 되돌린다 — 모드를 바꾼 테스트의 afterAll·각 테스트 시작에서 부른다 */
export async function resetWorkerMode(pool: Pool): Promise<void> {
    await pool.query(`UPDATE knowledge_worker_mode SET mode = 'inprocess', updated_at = NOW() WHERE id = 1`);
}
