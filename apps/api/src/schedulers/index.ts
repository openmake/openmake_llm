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

    // 4. 디버그 큐 정리 스케줄러 (메모리 생명주기는 MemoryService 폐기와 함께 제거)
    await startDebugQueueScheduler();

    // 5. 에이전트 자기개선 사이클 스케줄러
    await startAgentLearningScheduler();

    // 6. Cloud 모델 헬스체크 스케줄러 — 단일 로컬 모델 전환 (2026-05-06) 후 비활성.
    //    `model-health-monitor` 가 스텁(항상 healthy, 빈 스냅샷)이라 5분 주기 호출은 no-op.
    //    Cloud 모델 재도입 시 이 줄의 주석을 해제하여 즉시 복구 가능.
    // startModelHealthScheduler();

    // 7. 로컬 모델 가용성 polling — startup probe 이후 backend 장애 동적 감지
    startLocalModelProbeScheduler();

    // 8. Task 샌드박스 정리 (플래그 ON 시) — 고아 컨테이너(부팅 1회) + stale workspace(부팅 + 6h 주기).
    try {
        const { getTaskSandboxConfig } = await import('../config/task-sandbox');
        if (getTaskSandboxConfig().enabled) {
            const { reapOrphanTaskSandboxes, reapStaleWorkspaces } = await import('../services/task-sandbox/sandbox');
            await reapOrphanTaskSandboxes();
            await reapStaleWorkspaces(Date.now());
            const SIX_HOURS = 6 * 60 * 60 * 1000;
            setInterval(() => { void reapStaleWorkspaces(Date.now()).catch(() => { /* noop */ }); }, SIX_HOURS).unref();
            logger.debug('TaskSandbox 정리 스케줄 등록 완료');
        }
    } catch (err) {
        logger.warn('TaskSandbox 정리 실패(무시):', err);
    }

    // 9. 아티팩트 실행 히스토리 TTL 스윕 — persistTtlMs 초과 실행 결과 삭제(부팅 + 6h 주기).
    try {
        const { ARTIFACT_EXEC } = await import('../config/artifact-exec');
        if (ARTIFACT_EXEC.persistEnabled) {
            const { ArtifactExecutionRepository } = await import('../data/repositories/artifact-execution-repository');
            const { getPool } = await import('../data/models/unified-database');
            const sweep = async () => {
                const n = await new ArtifactExecutionRepository(getPool()).deleteOlderThan(Date.now() - ARTIFACT_EXEC.persistTtlMs);
                if (n) logger.info(`아티팩트 실행 히스토리 ${n}건 TTL 정리`);
            };
            await sweep().catch(() => { /* noop */ });
            const SIX_HOURS = 6 * 60 * 60 * 1000;
            setInterval(() => { void sweep().catch(() => { /* noop */ }); }, SIX_HOURS).unref();
            logger.debug('아티팩트 실행 히스토리 TTL 스윕 등록 완료');
        }
    } catch (err) {
        logger.warn('아티팩트 실행 히스토리 스윕 등록 실패(무시):', err);
    }

    logger.info('모든 백그라운드 스케줄러 시작 완료');
}

/**
 * 로컬 모델 가용성 polling 스케줄러.
 *
 * 동작:
 *   - 서버 startup probe (server.ts) 이후 N분마다 probeLocalModelAvailability 재실행
 *   - 카탈로그의 `available` 플래그 자동 갱신
 *   - 상태 전환 시 (up → down, down → up) info 로그
 *
 * 환경변수:
 *   - LLM_MODEL_PROBE_INTERVAL_MS (default 5분)
 *   - 0 또는 음수 시 스케줄러 비활성 (startup probe 만 사용)
 */
function startLocalModelProbeScheduler(): void {
    const intervalMs = parseInt(process.env.LLM_MODEL_PROBE_INTERVAL_MS || '300000', 10);
    if (!intervalMs || intervalMs <= 0) {
        logger.debug('LocalModelProbeScheduler 비활성 (LLM_MODEL_PROBE_INTERVAL_MS <= 0)');
        return;
    }

    // 상태 전환 감지 위한 직전 스냅샷
    let prevAvailable: Set<string> | null = null;

    const runProbe = async () => {
        try {
            const { probeLocalModelAvailability } = await import('../config/local-models');
            const { getConfig } = await import('../config/env');
            const cfg = getConfig();
            const r = await probeLocalModelAvailability(cfg.llmBaseUrl, cfg.llmApiKey);
            if (!r.probed) return;

            const currentAvailable = new Set(r.available);
            if (prevAvailable) {
                const newlyDown = [...prevAvailable].filter(id => !currentAvailable.has(id));
                const newlyUp = [...currentAvailable].filter(id => !prevAvailable!.has(id));
                if (newlyDown.length > 0) {
                    logger.warn(`[LocalModelProbe] DOWN: ${newlyDown.join(', ')}`);
                }
                if (newlyUp.length > 0) {
                    logger.info(`[LocalModelProbe] UP: ${newlyUp.join(', ')}`);
                }
                if (newlyDown.length === 0 && newlyUp.length === 0) {
                    logger.debug(`[LocalModelProbe] 변경 없음 (available=${r.available.length})`);
                }
            }
            prevAvailable = currentAvailable;
        } catch (err) {
            logger.error('[LocalModelProbe] polling 실패:', err);
        }
    };

    const timer = setInterval(runProbe, intervalMs);
    timer.unref();
    activeTimers.push(timer);
    logger.debug(`LocalModelProbeScheduler 시작 완료 (주기 ${intervalMs / 1000}s)`);
}

/**
 * Cloud 모델 헬스체크 스케줄러를 시작합니다.
 *
 * - 부팅 후 30초 뒤 1차 실행 (워밍업)
 * - 이후 5분마다 반복
 * - 스냅샷은 ModelHealthMonitor 싱글톤에 저장되어 routing-circuit-breaker와
 *   Admin UI에서 조회됨
 */
// Cloud 재도입 시 외부에서 직접 호출 가능하도록 export 유지 (현재는 비활성)
export function startModelHealthScheduler(): void {
    const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5분
    const WARMUP_DELAY_MS = 30 * 1000; // 30초

    const runCheck = async () => {
        try {
            const { getModelHealthMonitor } = await import('../services/model-health-monitor');
            const snapshot = await getModelHealthMonitor().runCheck({ full: false });
            if (snapshot.unhealthyCount > 0) {
                const unhealthyDetails = snapshot.summary
                    .filter((s) => !s.healthy)
                    .map((s) => {
                        const err = s.errors[0];
                        const detail = err
                            ? ` (HTTP ${err.httpStatus}${err.error ? ': ' + err.error : ''})`
                            : '';
                        return `${s.model}${detail}`;
                    })
                    .join(', ');
                logger.warn(
                    `[ModelHealth] ${snapshot.unhealthyCount}/${snapshot.modelCount} 모델 장애 — ${unhealthyDetails}`,
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
 * 디버그 큐 TTL 정리 스케줄러 (1시간마다).
 * (메모리 생명주기 스케줄러는 2026-05-19 MemoryService 폐기와 함께 제거)
 */
async function startDebugQueueScheduler(): Promise<void> {
    try {
        const debugQueueCleanupTimer = setInterval(async () => {
            try {
                const { cleanupExpiredDebugQueue } = await import('../data/conversation-debug-queue');
                await cleanupExpiredDebugQueue();
            } catch (e) {
                logger.error('[DebugQueue] 정리 실패:', e);
            }
        }, 60 * 60 * 1000);
        debugQueueCleanupTimer.unref();
        activeTimers.push(debugQueueCleanupTimer);
        logger.debug('디버그 큐 스케줄러 시작 완료');
    } catch (err) {
        logger.error('디버그 큐 스케줄러 시작 실패:', err);
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
