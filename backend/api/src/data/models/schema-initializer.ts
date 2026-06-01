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

const SCHEMA_FILE_RELATIVE_PATH = 'services/database/init/002-schema.sql';

/**
 * 002-schema.sql 파일 탐색 (cwd / __dirname 상대 경로 모두 시도).
 * 발견 실패 시 LEGACY_SCHEMA (inline) fallback.
 */
export function getSchemaSql(): { schema: string; source: string } {
    const candidatePaths = [
        path.resolve(process.cwd(), SCHEMA_FILE_RELATIVE_PATH),
        path.resolve(__dirname, '../../../../../services/database/init/002-schema.sql'),
        path.resolve(__dirname, '../../../../services/database/init/002-schema.sql'),
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

    // 좀비 작업 정리: 이전 프로세스에서 running 이던 AgentTask 는 in-memory 루프가
    // 사라져 복구 불가 → failed 로 마킹하여 프론트의 무한 polling 을 방지한다.
    // checkpoint 가 있으면 프론트에서 '이어하기(resume)' 가능 (status=failed + error='server restarted').
    try {
        await pool.query(
            `UPDATE agent_tasks SET status = 'failed', error = 'server restarted', completed_at = NOW() WHERE status = 'running'`,
        );
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
