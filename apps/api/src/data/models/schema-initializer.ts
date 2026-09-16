/**
 * ============================================================
 * Schema Initializer — PostgreSQL 스키마 자동 초기화
 * ============================================================
 *
 * unified-database.ts 에서 추출. 서버 시작 시 1회 실행:
 *   1. 002-schema.sql 파일 탐색 → 없으면 LEGACY_SCHEMA fallback
 *   2. 전체 스키마 적용 (CREATE TABLE IF NOT EXISTS)
 *   3. agent_usage_logs FK migration (ON DELETE SET NULL)
 *   4. pg_trgm 트라이그램 인덱스 생성 (확장 미지원 시 skip)
 *
 * @module data/models/schema-initializer
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Pool } from 'pg';
import { withRetry } from '../retry-wrapper';
import { createLogger } from '../../utils/logger';
import { LEGACY_SCHEMA } from './legacy-schema';

const logger = createLogger('SchemaInitializer');

const SCHEMA_FILE_RELATIVE_PATH = 'db/init/002-schema.sql';

/**
 * 002-schema.sql 파일 탐색 (cwd / __dirname 상대 경로 모두 시도).
 * 발견 실패 시 LEGACY_SCHEMA (inline) fallback.
 */
function getSchemaSql(): { schema: string; source: string } {
    const candidatePaths = [
        path.resolve(process.cwd(), SCHEMA_FILE_RELATIVE_PATH),
        path.resolve(__dirname, '../../../../../db/init/002-schema.sql'),
        path.resolve(__dirname, '../../../../db/init/002-schema.sql'),
    ];

    for (const filePath of candidatePaths) {
        try {
            const schema = fs.readFileSync(filePath, 'utf8');
            return { schema, source: `file:${filePath}` };
        } catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') {
                logger.warn(`Failed reading schema file at ${filePath}:`, err);
            }
        }
    }

    logger.warn('Schema SQL file not found; falling back to LEGACY_SCHEMA');
    return { schema: LEGACY_SCHEMA, source: 'inline:LEGACY_SCHEMA' };
}

/**
 * 스키마 초기화 전체 시퀀스 — pool 받아서 1회 실행.
 *
 * 1. schema SQL 적용 (idempotent — IF NOT EXISTS)
 * 2. agent_usage_logs FK 보정 (ON DELETE SET NULL)
 * 3. pg_trgm 확장 + GIN 인덱스 (user_memories.content)
 *
 * 멱등 — 재실행 안전.
 */
export async function initSchema(pool: Pool): Promise<void> {
    const { schema, source } = getSchemaSql();
    logger.info(`Initializing schema from ${source}`);
    await withRetry(
        () => pool.query(schema),
        { operation: 'initialize schema from SQL source' },
    );

    // Migration: agent_usage_logs FK to use SET NULL on delete
    try {
        await withRetry(
            () => pool.query(`
                ALTER TABLE agent_usage_logs DROP CONSTRAINT IF EXISTS agent_usage_logs_session_id_fkey;
                ALTER TABLE agent_usage_logs ADD CONSTRAINT agent_usage_logs_session_id_fkey
                    FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE SET NULL;
            `),
            { operation: 'agent_usage_logs FK migration' },
        );
    } catch {
        // Constraint may already be correct — ignore
    }

    // agent_tasks resume: end-of-turn conversation 체크포인트 컬럼 (기존 DB ALTER, 멱등)
    try {
        await pool.query(`ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS checkpoint JSONB`);
    } catch {
        // 테이블 미존재(최초 부팅) 등 — 무시
    }

    // 좀비 작업 정리: 이전 프로세스에서 running/paused 이던 AgentTask 는 in-memory 루프
    // (paused 는 승인 대기 waiter)가 사라져 복구 불가 → failed 로 마킹하여 프론트의
    // 무한 polling·영구 paused 를 방지한다.
    // checkpoint 가 있으면 프론트에서 '이어하기(resume)' 가능 (status=failed + error='server restarted').
    try {
        // 전이 이벤트(124)를 먼저 남긴다 — 이 마킹은 상태 머신을 거치지 않는 유일한 bulk 경로다.
        await pool.query(
            `INSERT INTO agent_task_events (task_id, from_status, to_status, reason)
             SELECT id, status, 'failed', 'server restarted' FROM agent_tasks WHERE status IN ('running', 'paused')`,
        ).catch(() => { /* 이벤트 테이블 미생성(마이그레이션 전) — 마킹은 그대로 진행 */ });
        await pool.query(
            `UPDATE agent_tasks SET status = 'failed', error = 'server restarted', completed_at = NOW() WHERE status IN ('running', 'paused')`,
        );
    } catch {
        // 테이블 미존재(최초 부팅) 등 — 무시
    }
    // 실패 분류(131) — 이 초기화는 마이그레이션보다 먼저 돈다. 컬럼이 아직 없으면(131 적용 전 부팅) 조용히 건너뛰고
    // 마이그레이션 백필이 분류한다. 위 마킹과 한 문장에 넣으면 컬럼 부재로 마킹까지 실패한다.
    await pool.query(
        `UPDATE agent_tasks SET failure_class = 'interrupted' WHERE status = 'failed' AND error = 'server restarted' AND failure_class IS NULL`,
    ).catch(() => { /* 131 적용 전 */ });

    // 좀비 리서치 정리: Deep Research 는 큐·워커 없이 in-process 파이프라인으로 돌기 때문에
    // (세션 생성 직후 같은 흐름에서 running 으로 전이) 이전 프로세스의 pending/running 세션은
    // 아무도 이어받지 못한다. 마킹하지 않으면 프론트에 영구 '진행 중' 으로 남는다.
    // 2026-07-30 실측: 7/26 중단으로 running 3건이 나흘째 방치돼 있었다(51건 중 3건).
    // agent_tasks 와 달리 resume 이 없어 error 컬럼도 없으므로 status/completed_at 만 정리한다.
    try {
        const r = await pool.query(
            `UPDATE research_sessions SET status = 'failed', completed_at = NOW() WHERE status IN ('pending', 'running')`,
        );
        if (r.rowCount) {
            logger.info(`중단된 리서치 세션 ${r.rowCount}건을 failed 로 정리`);
        }
    } catch {
        // 테이블 미존재(최초 부팅) 등 — 무시
    }

    // pg_trgm GIN 인덱스 (확장 미지원 환경에서는 skip)
    try {
        await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_memories_content_trgm ON user_memories USING gin (content gin_trgm_ops)`);
        logger.info('pg_trgm 트라이그램 인덱스 생성 완료');
    } catch {
        logger.info('pg_trgm 인덱스 생성 건너뜀 (확장 미지원 환경)');
    }
}
