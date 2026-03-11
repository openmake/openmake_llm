/**
 * ============================================================
 * DB Retention - 데이터 보존 정리 스케줄러
 * ============================================================
 *
 * 만료된 DB 레코드를 주기적으로 정리합니다.
 * 대상 테이블:
 * - uploaded_documents : expires_at 기준 만료 문서 삭제
 * - token_blacklist    : expires_at(ms epoch) 기준 만료 토큰 삭제
 * - oauth_states       : 10분 이상 경과한 OAuth state 삭제
 *
 * @module data/db-retention
 */

import { getUnifiedDatabase } from './models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('DbRetention');

/** 정리 주기: 1시간 (밀리초) */
const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 만료된 레코드를 정리합니다.
 * 각 테이블별 삭제 쿼리를 실행하고 삭제된 행 수를 로그에 기록합니다.
 */
async function runRetention(): Promise<void> {
    try {
        const db = getUnifiedDatabase();
        const pool = db.getPool();

        // 1. 만료된 업로드 문서 삭제
        const docResult = await pool.query(
            `DELETE FROM uploaded_documents WHERE expires_at < NOW()`
        );
        if ((docResult.rowCount ?? 0) > 0) {
            logger.info(`[DbRetention] 만료 문서 ${docResult.rowCount}건 삭제 완료`);
        }

        // 2. 만료된 토큰 블랙리스트 항목 삭제 (expires_at은 ms epoch)
        const now = Date.now();
        const tokenResult = await pool.query(
            `DELETE FROM token_blacklist WHERE expires_at < $1`,
            [now]
        );
        if ((tokenResult.rowCount ?? 0) > 0) {
            logger.info(`[DbRetention] 만료 블랙리스트 토큰 ${tokenResult.rowCount}건 삭제 완료`);
        }

        // 3. 10분 이상 경과한 OAuth state 삭제
        const oauthResult = await pool.query(
            `DELETE FROM oauth_states WHERE created_at < NOW() - INTERVAL '10 minutes'`
        );
        if ((oauthResult.rowCount ?? 0) > 0) {
            logger.info(`[DbRetention] 만료 OAuth state ${oauthResult.rowCount}건 삭제 완료`);
        }

    } catch (err) {
        logger.error('[DbRetention] 정리 작업 중 오류 발생:', err);
    }
}

/**
 * DB 데이터 보존 정리 스케줄러를 시작합니다.
 * 서버 시작 시 한 번만 호출되어야 합니다.
 * 즉시 1회 실행 후 RETENTION_INTERVAL_MS 마다 반복 실행됩니다.
 */
export function startDbRetention(): void {
    // 서버 시작 직후 1회 즉시 실행
    void runRetention();

    // 이후 주기적 실행
    const timer = setInterval(() => {
        void runRetention();
    }, RETENTION_INTERVAL_MS);

    // Node.js 프로세스 종료를 막지 않도록 unref 설정
    if (timer.unref) {
        timer.unref();
    }

    logger.info(`[DbRetention] 스케줄러 시작 (주기: ${RETENTION_INTERVAL_MS / 1000 / 60}분)`);
}
