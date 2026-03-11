/**
 * Scheduler module - periodic background tasks
 *
 * Extracted from server.ts to consolidate all setInterval-based
 * schedulers into a single module.
 */

import { startSessionCleanupScheduler } from '../data/conversation-db';
import { startDbRetention } from '../data/db-retention';
import { startPeriodicCleanup } from '../utils/token-cleanup';

/** All scheduler timers for cleanup on shutdown */
const schedulerTimers: NodeJS.Timeout[] = [];

/**
 * Start all periodic schedulers.
 * Returns the timer array for graceful shutdown cleanup.
 */
export async function startSchedulers(): Promise<NodeJS.Timeout[]> {
    // 세션 자동 정리 스케줄러 (24시간마다 30일 이상 된 세션 정리)
    startSessionCleanupScheduler(24);

    // DB 데이터 보존 정리 스케줄러 (만료 문서, 토큰, OAuth state 정리)
    startDbRetention();

    // 토큰 블랙리스트/레이트리밋 만료 데이터 주기 정리 스케줄러
    startPeriodicCleanup();

    // 메모리 생명주기 관리 스케줄러
    try {
        const { getUnifiedDatabase } = await import('../data/models/unified-database');
        const db = getUnifiedDatabase();

        // 만료 메모리 정리 (1시간마다)
        const memCleanupTimer = setInterval(async () => {
            try {
                const deleted = await db.cleanupExpiredMemories();
                if (deleted > 0) console.log(`[MemoryGC] 만료 메모리 ${deleted}개 정리`);
            } catch (e) {
                console.error('[MemoryGC] 만료 정리 실패:', e);
            }
        }, 60 * 60 * 1000);
        memCleanupTimer.unref();
        schedulerTimers.push(memCleanupTimer);

        // 중요도 감쇠 (24시간마다)
        const memDecayTimer = setInterval(async () => {
            try {
                const decayed = await db.decayMemoryImportance();
                if (decayed > 0) console.log(`[MemoryGC] 중요도 감쇠 적용: ${decayed}개`);
            } catch (e) {
                console.error('[MemoryGC] 중요도 감쇠 실패:', e);
            }
        }, 24 * 60 * 60 * 1000);
        memDecayTimer.unref();
        schedulerTimers.push(memDecayTimer);

        // 메모리 통합: 중복 메모리 병합 (12시간마다)
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
                    console.log(`[MemoryGC] 메모리 통합: ${totalConsolidated}개 중복 제거`);
                }
            } catch (e) {
                console.error('[MemoryGC] 메모리 통합 실패:', e);
            }
        }, 12 * 60 * 60 * 1000);
        memConsolidateTimer.unref();
        schedulerTimers.push(memConsolidateTimer);
    } catch (err) {
        console.error('[Server] 메모리 생명주기 스케줄러 시작 실패:', err);
    }

    // 에이전트 자기개선 사이클 스케줄러 (24시간마다)
    try {
        const { getAgentLearningSystem } = await import('../agents/learning');
        const learningTimer = setInterval(async () => {
            try {
                const result = await getAgentLearningSystem().runSelfImprovementCycle();
                if (result.suggestions > 0) {
                    console.log(`[SelfImprove] ${result.improvedAgents.length}개 에이전트, ${result.suggestions}개 개선 제안`);
                }
            } catch (e) {
                console.error('[SelfImprove] 자기개선 사이클 실패:', e);
            }
        }, 24 * 60 * 60 * 1000);
        learningTimer.unref();
        schedulerTimers.push(learningTimer);
    } catch (err) {
        console.error('[Server] 자기개선 스케줄러 시작 실패:', err);
    }

    // 시맨틱 분류 캐시 워밍 (비동기, 서버 시작 차단 안 함)
    try {
        const { warmClassificationCache } = await import('../chat/llm-classifier');
        warmClassificationCache().catch((err: unknown) => console.error('[Server] 캐시 워밍 실패:', err));
    } catch (err) {
        console.error('[Server] 캐시 워밍 로드 실패:', err);
    }

    return schedulerTimers;
}

/**
 * Get the scheduler timers array (for shutdown cleanup).
 */
export function getSchedulerTimers(): NodeJS.Timeout[] {
    return schedulerTimers;
}

/**
 * Clear all scheduler timers.
 */
export function clearSchedulerTimers(): void {
    for (const timer of schedulerTimers) {
        clearInterval(timer);
    }
    schedulerTimers.length = 0;
}
