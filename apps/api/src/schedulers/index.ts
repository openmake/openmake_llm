/**
 * 중앙 집중식 스케줄러 관리 모듈
 * 
 * 시스템의 모든 백그라운드 작업 및 정리 스케줄러를 한 곳에서 관리합니다.
 * @module schedulers
 */

import { startSessionCleanupScheduler, stopSessionCleanupScheduler } from '../data/conversation-db';
import { startQuotaReconcileJob, stopQuotaReconcileJob } from '../services/cost/quota-reconcile-job';
import { startDbRetention } from '../data/db-retention';
import { startPeriodicCleanup } from '../utils/token-cleanup';
import { createLogger } from '../utils/logger';
import { CLEANUP_INTERVALS } from '../config/timeouts';

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
        startQuotaReconcileJob();
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

    // 6. 로컬 모델 가용성 polling — startup probe 이후 backend 장애 동적 감지
    startLocalModelProbeScheduler();

    // 6-b. /generated 생성 미디어 보존 스윕 (부팅 1회 + 주기) — reports/ 제외
    try {
        const { reapStaleGeneratedMedia } = await import('../services/generated-media-retention');
        reapStaleGeneratedMedia();
        setInterval(() => { try { reapStaleGeneratedMedia(); } catch { /* noop */ } }, CLEANUP_INTERVALS.MAINTENANCE_SWEEP_MS).unref();
    } catch (err) {
        logger.warn('생성 미디어 스윕 등록 실패 (계속):', err);
    }

    // 7. Task 샌드박스 정리 (플래그 ON 시) — 고아 컨테이너(부팅 1회) + stale workspace(부팅 + 6h 주기).
    try {
        const { getTaskSandboxConfig } = await import('../config/task-sandbox');
        if (getTaskSandboxConfig().enabled) {
            const { reapOrphanTaskSandboxes, reapStaleWorkspaces } = await import('../services/task-sandbox/sandbox');
            await reapOrphanTaskSandboxes();
            await reapStaleWorkspaces(Date.now());
            setInterval(() => { void reapStaleWorkspaces(Date.now()).catch(() => { /* noop */ }); }, CLEANUP_INTERVALS.MAINTENANCE_SWEEP_MS).unref();
            logger.debug('TaskSandbox 정리 스케줄 등록 완료');
        }
    } catch (err) {
        logger.warn('TaskSandbox 정리 실패(무시):', err);
    }

    // 7-a. 채팅 요청 사실 테이블 보존 정리(F24.2, 142) — 요청 행 90일·미사용 지문 180일
    try {
        const { CHAT_REQUESTS } = await import('../config/runtime-limits');
        if (CHAT_REQUESTS.ENABLED) {
            const { ChatRequestRepository } = await import('../data/repositories/chat-request-repository');
            const { getPool } = await import('../data/models/unified-database');
            const purge = () => new ChatRequestRepository(getPool()).purge(CHAT_REQUESTS.RETENTION_DAYS, CHAT_REQUESTS.FINGERPRINT_RETENTION_DAYS)
                .then((r) => { if (r.requests || r.fingerprints) logger.info(`chat_requests 보존 정리: 요청 ${r.requests} · 지문 ${r.fingerprints}`); })
                .catch(() => { /* 142 적용 전 등 — 다음 주기에 재시도 */ });
            void purge();
            setInterval(() => { void purge(); }, CLEANUP_INTERVALS.MAINTENANCE_SWEEP_MS).unref();
        }
    } catch (err) {
        logger.warn('chat_requests 보존 정리 등록 실패(무시):', err);
    }

    // 7-c. 노드 지표 스크레이프·큐 깊이 샘플(F24.4, 143) — vLLM /metrics 60초·큐 깊이 30초, 14일 보존. 전부 fail-open
    try {
        const { NODE_METRICS } = await import('../config/runtime-limits');
        if (NODE_METRICS.ENABLED) {
            const { scrapeNodeMetricsOnce, currentVllmWaiting } = await import('../cluster/node-metrics-collector');
            const { sampleQueueDepth } = await import('../monitoring/queue-depth-sampler');
            const { NodeMetricsRepository } = await import('../data/repositories/node-metrics-repository');
            const { getAgentTaskQueue } = await import('../services/agent-task/task-queue');
            const { getPool } = await import('../data/models/unified-database');
            const repo = () => new NodeMetricsRepository(getPool());
            const scrape = () => scrapeNodeMetricsOnce().then((rows) => repo().insertSamples(rows)).catch(() => { /* 143 적용 전 등 */ });
            const sample = () => sampleQueueDepth(getPool(), { queueStats: () => getAgentTaskQueue().stats(), vllmWaiting: () => currentVllmWaiting() })
                .then(({ rows }) => repo().insertSamples(rows)).catch(() => { /* noop */ });
            const purge = () => repo().purge(NODE_METRICS.RETENTION_DAYS).catch(() => 0);
            void scrape();
            setInterval(() => { void scrape(); }, NODE_METRICS.POLL_MS).unref();
            setInterval(() => { void sample(); }, NODE_METRICS.QUEUE_SAMPLE_MS).unref();
            void purge();
            setInterval(() => { void purge(); }, CLEANUP_INTERVALS.MAINTENANCE_SWEEP_MS).unref();
        }
    } catch (err) {
        logger.warn('노드 지표 수집 등록 실패(무시):', err);
    }

    // 7-d. SLO 평가(F24.8, 145) — 5분 tick: SLI·버짓·burn-rate 스냅샷 + 악화 시 알림, 스냅샷 400일 보존
    try {
        const { SLO_LIMITS } = await import('../config/slo');
        const { runSloTick } = await import('../monitoring/slo-runner');
        const { SloRepository } = await import('../data/repositories/slo-repository');
        const { getAlertSystem } = await import('../monitoring/alerts');
        const { getPool } = await import('../data/models/unified-database');
        const tick = () => runSloTick(getPool(), (...a) => getAlertSystem().sendAlert(...a)).catch(() => { /* noop */ });
        setTimeout(() => { void tick(); }, SLO_LIMITS.FIRST_TICK_DELAY_MS).unref();
        setInterval(() => { void tick(); }, SLO_LIMITS.TICK_MS).unref();
        setInterval(() => { void new SloRepository(getPool()).purge(SLO_LIMITS.SNAPSHOT_RETENTION_DAYS).catch(() => 0); }, CLEANUP_INTERVALS.MAINTENANCE_SWEEP_MS).unref();
    } catch (err) {
        logger.warn('SLO 평가 등록 실패(무시):', err);
    }

    // 7-e. LLM 요청 셰도우 계측 보존 정리(F06.2 G0, 158) — 90일
    try {
        const { LLM_REQUEST_METRICS } = await import('../config/runtime-limits');
        const { getPool } = await import('../data/models/unified-database');
        const purgeLlmMetrics = () => getPool().query('DELETE FROM llm_request_metrics WHERE created_at < NOW() - make_interval(days => $1)', [LLM_REQUEST_METRICS.RETENTION_DAYS])
            .catch(() => undefined);
        setInterval(() => { void purgeLlmMetrics(); }, CLEANUP_INTERVALS.MAINTENANCE_SWEEP_MS).unref();
    } catch (err) {
        logger.warn('LLM 요청 계측 보존 정리 등록 실패(무시):', err);
    }

    // 7-b. 질문 응답 대기 주차 스윕(F16.7) — 결정 도착분 재개·상한 초과분 실패·대기분 workspace 유지(주차가 없으면 조회 1회)
    try {
        const { sweepParkedTasks } = await import('../services/agent-task/hitl-park');
        const { AGENT_TASK_LIMITS } = await import('../config/runtime-limits');
        void sweepParkedTasks();
        setInterval(() => { void sweepParkedTasks(); }, AGENT_TASK_LIMITS.HITL_PARK_SWEEP_MS).unref();
    } catch (err) {
        logger.warn('주차 스윕 등록 실패(무시):', err);
    }

    // 8-B. Agent Task 부팅 자동 복구 — 재시작으로 running/paused 로 박제된 task 를 스윕.
    //      샌드박스 플래그와 무관하게 실행(비-샌드박스 task 도 좀비가 된다). 반드시 위
    //      reapOrphanTaskSandboxes() 이후 — 먼저 돌면 resume 이 만든 컨테이너를 reap 이 죽인다.
    try {
        const { recoverInterruptedAgentTasks } = await import('../services/agent-task/boot-recovery');
        const { resumed, failed } = await recoverInterruptedAgentTasks();
        if (resumed || failed) logger.info(`Agent Task 부팅 복구: 재개 ${resumed} / 실패정리 ${failed}`);
    } catch (err) {
        logger.warn('Agent Task 부팅 복구 실패(무시):', err);
    }

    // 8-C. Agent Task 스케줄/반복 트리거 — 플래그 ON 시 cron/interval due 스캔(tick 주기).
    try {
        const { startAgentTaskScheduleScheduler } = await import('../services/agent-task/schedule-runner');
        if (startAgentTaskScheduleScheduler()) logger.debug('Agent Task 스케줄러 등록 완료');
    } catch (err) {
        logger.warn('Agent Task 스케줄러 등록 실패(무시):', err);
    }

    // 8-D. Agent Task 업로드 보존 스윕 — 종료 후 보존기간 지난 task 의 디스크 원본 회수 +
    //      tmp/·chunked/ 잔재 청소(부팅 + 6h 주기). 샌드박스 플래그와 무관 — 업로드 원본은
    //      비-샌드박스 task 도 무기한 쌓인다(removeTaskFiles 호출처가 롤백·삭제 2곳뿐).
    try {
        const { sweepExpiredTaskUploads } = await import('../services/agent-task/upload-retention');
        const { cleanupStaleChunkUploads } = await import('../services/agent-task/chunk-store');
        const { getPool } = await import('../data/models/unified-database');
        const sweep = async () => {
            const r = await sweepExpiredTaskUploads(getPool());
            await cleanupStaleChunkUploads();
            if (r.sweptTasks || r.orphanDirs || r.tmpFiles) {
                logger.info(`Agent Task 업로드 정리: 원본 회수 ${r.sweptTasks} / 고아 ${r.orphanDirs} / tmp ${r.tmpFiles}`);
            }
        };
        await sweep().catch(() => { /* noop */ });
        setInterval(() => { void sweep().catch(() => { /* noop */ }); }, CLEANUP_INTERVALS.MAINTENANCE_SWEEP_MS).unref();
        logger.debug('Agent Task 업로드 보존 스윕 등록 완료');
    } catch (err) {
        logger.warn('Agent Task 업로드 보존 스윕 등록 실패(무시):', err);
    }

    // 8. 아티팩트 실행 히스토리 TTL 스윕 — persistTtlMs 초과 실행 결과 삭제(부팅 + 6h 주기).
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
            setInterval(() => { void sweep().catch(() => { /* noop */ }); }, CLEANUP_INTERVALS.MAINTENANCE_SWEEP_MS).unref();
            logger.debug('아티팩트 실행 히스토리 TTL 스윕 등록 완료');
        }
    } catch (err) {
        logger.warn('아티팩트 실행 히스토리 스윕 등록 실패(무시):', err);
    }

    // 9. 주간 게이트 판정 리포트 — measure-first 게이트 관측 스냅샷(무-LLM, 멱등).
    try {
        const { startGateReportScheduler } = await import('../monitoring/gate-report');
        if (startGateReportScheduler()) logger.debug('GateReportScheduler 등록 완료');
    } catch (err) {
        logger.warn('GateReportScheduler 등록 실패(무시):', err);
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
        const { AGENT_SELF_IMPROVE } = await import('../config/runtime-limits');

        const runCycle = async (): Promise<void> => {
            try {
                const result = await getAgentLearningSystem().runSelfImprovementCycle();
                if (result.suggestions > 0) {
                    logger.info(`[SelfImprove] ${result.improvedAgents.length}개 에이전트, ${result.suggestions}개 개선 제안`);
                }
            } catch (e) {
                logger.error('[SelfImprove] 자기개선 사이클 실패:', e);
            }
        };

        // 부팅 시 인메모리 피드백 복원 — 이게 없으면 사이클이 훑을 대상이 이번 프로세스
        // 유입분뿐이라, 재시작이 잦은 환경에선 사실상 아무것도 분석하지 못한다.
        const hydrateTimer = setTimeout(() => {
            void (async () => {
                await getAgentLearningSystem().hydrateFromDb();
                // 복원 직후 1회 실행 — 구 구현은 24h setInterval 뿐이라 프로세스가 24시간을
                // 넘기지 못하는 환경에서 사이클이 한 번도 돌지 않았다.
                await runCycle();
            })();
        }, AGENT_SELF_IMPROVE.FIRST_RUN_DELAY_MS);
        hydrateTimer.unref();
        activeTimers.push(hydrateTimer);

        const learningTimer = setInterval(() => { void runCycle(); }, AGENT_SELF_IMPROVE.INTERVAL_MS);
        learningTimer.unref();
        activeTimers.push(learningTimer);
        logger.debug(
            `자기개선 스케줄러 시작 완료 (첫 실행 ${AGENT_SELF_IMPROVE.FIRST_RUN_DELAY_MS}ms 후, 주기 ${AGENT_SELF_IMPROVE.INTERVAL_MS}ms)`,
        );
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

    // 2. 쿼터 정산 잡 중지 — 자체 모듈 타이머라 activeTimers 루프가 잡지 못한다.
    try {
        stopQuotaReconcileJob();
    } catch (err) {
        logger.error('QuotaReconcileJob 중지 실패:', err);
    }

    // 3. 타이머 기반 스케줄러 정리
    for (const timer of activeTimers) {
        clearInterval(timer);
    }
    activeTimers.length = 0;

    logger.info('모든 백그라운드 스케줄러 종료 완료');
}
