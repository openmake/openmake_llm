/**
 * 중앙 집중식 스케줄러 관리 모듈
 * 
 * 시스템의 모든 백그라운드 작업 및 정리 스케줄러를 한 곳에서 관리합니다.
 * @module schedulers
 */

import { startSessionCleanupScheduler, stopSessionCleanupScheduler } from '../data/conversation-db';
import { startDbRetention } from '../data/db-retention';
import { startPeriodicCleanup } from '../utils/token-cleanup';
import { createLogger } from '../utils/logger';

const logger = createLogger('Schedulers');

/** 전역 타이머 관리 */
const activeTimers: NodeJS.Timeout[] = [];

/**
 * 모든 백그라운드 스케줄러를 시작합니다.
 */
export async function startAllSchedulers(): Promise<void> {
    logger.info('모든 백그라운드 스케줄러 시작 중...');

    // 1. 세션 자동 정리 스케줄러 (24시간마다 30일 이상 된 세션 정리)
    try {
        startSessionCleanupScheduler(24);
        logger.debug('SessionCleanupScheduler 시작 완료');
    } catch (err) {
        logger.error('SessionCleanupScheduler 시작 실패:', err);
    }

    // 2. DB 데이터 보존 정리 스케줄러 (만료 문서, 토큰, OAuth state 정리)
    try {
        startDbRetention();
        logger.debug('DbRetentionScheduler 시작 완료');
    } catch (err) {
        logger.error('DbRetentionScheduler 시작 실패:', err);
    }

    // 3. 토큰 블랙리스트/레이트리밋 만료 데이터 주기 정리
    try {
        startPeriodicCleanup();
        logger.debug('PeriodicCleanupScheduler 시작 완료');
    } catch (err) {
        logger.error('PeriodicCleanupScheduler 시작 실패:', err);
    }

    // 4. 메모리 생명주기 관리 스케줄러 (만료 정리, 중요도 감쇠, 통합)
    await startMemorySchedulers();

    // 5. 에이전트 자기개선 사이클 스케줄러
    await startAgentLearningScheduler();

    // 6. Cloud 모델 헬스체크 스케줄러 (5분마다 현재 활성 키로 전체 모델 ping)
    startModelHealthScheduler();

    logger.info('모든 백그라운드 스케줄러 시작 완료');
}

/**
 * Cloud 모델 헬스체크 스케줄러를 시작합니다.
 *
 * - 부팅 후 30초 뒤 1차 실행 (워밍업)
 * - 이후 5분마다 반복
 * - 스냅샷은 ModelHealthMonitor 싱글톤에 저장되어 routing-circuit-breaker와
 *   Admin UI에서 조회됨
 */
function startModelHealthScheduler(): void {
    const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5분
    const WARMUP_DELAY_MS = 30 * 1000; // 30초

    const runCheck = async () => {
        try {
            const { getModelHealthMonitor } = await import('../services/model-health-monitor');
            const snapshot = await getModelHealthMonitor().runCheck({ full: false });
            if (snapshot.unhealthyCount > 0) {
                logger.warn(
                    `[ModelHealth] ${snapshot.unhealthyCount}/${snapshot.modelCount} 모델 장애 — ` +
                    snapshot.summary
                        .filter((s) => !s.healthy)
                        .map((s) => s.model)
                        .join(', '),
                );
            } else {
                logger.debug(
                    `[ModelHealth] ${snapshot.healthyCount}/${snapshot.modelCount} 모델 정상 (${snapshot.totalDurationMs}ms)`,
                );
            }
        } catch (err) {
            logger.error('[ModelHealth] 헬스체크 실행 실패:', err);
        }
    };

    // 워밍업: 부팅 직후에는 실행하지 않고 30초 뒤에 1차 실행
    const warmupTimer = setTimeout(() => {
        runCheck();
        const interval = setInterval(runCheck, HEALTH_CHECK_INTERVAL_MS);
        interval.unref();
        activeTimers.push(interval);
    }, WARMUP_DELAY_MS);
    warmupTimer.unref();

    logger.debug(
        `ModelHealthScheduler 시작 완료 (워밍업 ${WARMUP_DELAY_MS / 1000}s, 주기 ${HEALTH_CHECK_INTERVAL_MS / 1000}s)`,
    );
}

/**
 * 메모리 관련 스케줄러들을 시작합니다.
 */
async function startMemorySchedulers(): Promise<void> {
    try {
        const { getUnifiedDatabase } = await import('../data/models/unified-database');
        const db = getUnifiedDatabase();

        // 4.1 만료 메모리 정리 (1시간마다)
        const memCleanupTimer = setInterval(async () => {
            try {
                const deleted = await db.cleanupExpiredMemories();
                if (deleted > 0) logger.info(`[MemoryGC] 만료 메모리 ${deleted}개 정리 완료`);
            } catch (e) {
                logger.error('[MemoryGC] 만료 메모리 정리 실패:', e);
            }
        }, 60 * 60 * 1000);
        memCleanupTimer.unref();
        activeTimers.push(memCleanupTimer);

        // 4.2 중요도 감쇠 적용 (24시간마다)
        const memDecayTimer = setInterval(async () => {
            try {
                const decayed = await db.decayMemoryImportance();
                if (decayed > 0) logger.info(`[MemoryGC] 중요도 감쇠 적용: ${decayed}개`);
            } catch (e) {
                logger.error('[MemoryGC] 중요도 감쇠 실패:', e);
            }
        }, 24 * 60 * 60 * 1000);
        memDecayTimer.unref();
        activeTimers.push(memDecayTimer);

        // 4.3 중복 메모리 병합 (12시간마다)
        const memConsolidateTimer = setInterval(async () => {
            try {
                const { getMemoryService } = await import('../services/MemoryService');
                const memoryService = getMemoryService();
                const pool = db.getPool();
                const result = await pool.query<{ user_id: string }>(
                    `SELECT DISTINCT user_id FROM user_memories
                     GROUP BY user_id HAVING COUNT(*) > 20
                     LIMIT 50`
                );
                let totalConsolidated = 0;
                for (const row of result.rows) {
                    const deleted = await memoryService.consolidateMemories(row.user_id);
                    totalConsolidated += deleted;
                }
                if (totalConsolidated > 0) {
                    logger.info(`[MemoryGC] 메모리 통합: ${totalConsolidated}개 중복 제거`);
                }
            } catch (e) {
                logger.error('[MemoryGC] 메모리 통합 실패:', e);
            }
        }, 12 * 60 * 60 * 1000);
        memConsolidateTimer.unref();
        activeTimers.push(memConsolidateTimer);

        logger.debug('메모리 생명주기 스케줄러 시작 완료');
    } catch (err) {
        logger.error('메모리 생명주기 스케줄러 시작 실패:', err);
    }
}

/**
 * 에이전트 자기개선 스케줄러를 시작합니다.
 */
async function startAgentLearningScheduler(): Promise<void> {
    try {
        const { getAgentLearningSystem } = await import('../agents/learning');
        const learningTimer = setInterval(async () => {
            try {
                const result = await getAgentLearningSystem().runSelfImprovementCycle();
                if (result.suggestions > 0) {
                    logger.info(`[SelfImprove] ${result.improvedAgents.length}개 에이전트, ${result.suggestions}개 개선 제안`);
                }
            } catch (e) {
                logger.error('[SelfImprove] 자기개선 사이클 실패:', e);
            }
        }, 24 * 60 * 60 * 1000);
        learningTimer.unref();
        activeTimers.push(learningTimer);
        logger.debug('자기개선 스케줄러 시작 완료');
    } catch (err) {
        logger.error('자기개선 스케줄러 시작 실패:', err);
    }
}

/**
 * 모든 스케줄러를 정상 종료합니다.
 */
export function stopAllSchedulers(): void {
    logger.info('모든 백그라운드 스케줄러 종료 중...');

    // 1. 세션 정리 스케줄러 중지
    try {
        stopSessionCleanupScheduler();
    } catch (err) {
        logger.error('SessionCleanupScheduler 중지 실패:', err);
    }

    // 2. 타이머 기반 스케줄러 정리
    for (const timer of activeTimers) {
        clearInterval(timer);
    }
    activeTimers.length = 0;

    logger.info('모든 백그라운드 스케줄러 종료 완료');
}
