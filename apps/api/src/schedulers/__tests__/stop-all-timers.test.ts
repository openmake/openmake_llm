/**
 * stopAllSchedulers() 가 startAllSchedulers() 가 건 타이머를 하나도 남기지 않는지 고정한다.
 *
 * 종전엔 `setInterval(...).unref()` 로 등록만 하고 핸들을 버린 타이머(생성 미디어 스윕·샌드박스 정리·주차 스윕·
 * 소유권 점검·보존 스윕 등)와, 시작 함수가 핸들을 돌려주지 않는 타이머(Job poller·DB 보존 정리·게이트 리포트)가
 * 종료 절차의 "스케줄러 중지" 뒤에도 계속 발화했다.
 *
 * 스케줄러가 부르는 모듈은 대부분 가짜다 — 타이머 등록 여부만 본다. 핸들을 돌려주는 시작 함수는 진짜 타이머를 건다.
 * 종료 알림 재전송(startTerminalNotifySweep)과 토큰 정리(startPeriodicCleanup)는 실제 시작 함수를 쓴다 —
 * 가짜로 바꾸면 시작 함수가 핸들을 내주지 않는 빈틈을 못 잡는다.
 */
const HOUR = 60 * 60 * 1000;

jest.mock('../../data/conversation-db', () => ({ startSessionCleanupScheduler: jest.fn(), stopSessionCleanupScheduler: jest.fn() }));
jest.mock('../../services/cost/quota-reconcile-job', () => ({ startQuotaReconcileJob: jest.fn(), stopQuotaReconcileJob: jest.fn() }));
jest.mock('../../data/db-retention', () => ({ startDbRetention: () => setInterval(() => undefined, HOUR) }));
jest.mock('../../utils/token-cleanup', () => {
    const actual = jest.requireActual('../../utils/token-cleanup');
    return { ...actual, stopPeriodicCleanup: jest.fn(actual.stopPeriodicCleanup) };
});
jest.mock('../../config/runtime-limits', () => ({
    ...jest.requireActual('../../config/runtime-limits'),
    CHAT_REQUESTS: { ENABLED: true, RETENTION_DAYS: 90, FINGERPRINT_RETENTION_DAYS: 180 },
    NODE_METRICS: { ENABLED: true, POLL_MS: 60_000, QUEUE_SAMPLE_MS: 30_000, RETENTION_DAYS: 14 },
    LLM_REQUEST_METRICS: { RETENTION_DAYS: 90 },
    AGENT_TASK_LIMITS: { HITL_PARK_SWEEP_MS: 600_000, HITL_PARK_EXPIRE_SWEEP_MS: 60_000, LEASE_ENABLED: true, LEASE_SWEEP_MS: 30_000 },
    AGENT_TASK_RETENTION: { ENABLED: true },
    AGENT_SELF_IMPROVE: { FIRST_RUN_DELAY_MS: 60_000, INTERVAL_MS: 24 * 60 * 60 * 1000 },
}));
jest.mock('../../config/slo', () => ({ SLO_LIMITS: { FIRST_TICK_DELAY_MS: 60_000, TICK_MS: 300_000, SNAPSHOT_RETENTION_DAYS: 400 } }));
jest.mock('../../config/task-sandbox', () => ({ getTaskSandboxConfig: () => ({ enabled: true }) }));
jest.mock('../../config/artifact-exec', () => ({ ARTIFACT_EXEC: { persistEnabled: true, persistTtlMs: HOUR } }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }) }));
jest.mock('../../services/generated-media-retention', () => ({ reapStaleGeneratedMedia: jest.fn() }));
jest.mock('../../services/job-poller', () => ({ startJobRuntime: async () => setInterval(() => undefined, 30_000) }));
jest.mock('../../services/task-sandbox/sandbox', () => ({ reapOrphanTaskSandboxes: async () => undefined, reapStaleWorkspaces: async () => undefined }));
jest.mock('../../data/repositories/chat-request-repository', () => ({
    ChatRequestRepository: class { purge = async () => ({ requests: 0, fingerprints: 0 }); },
}));
jest.mock('../../cluster/node-metrics-collector', () => ({ scrapeNodeMetricsOnce: async () => [], currentVllmWaiting: () => 0 }));
jest.mock('../../monitoring/queue-depth-sampler', () => ({ sampleQueueDepth: async () => ({ rows: [] }) }));
jest.mock('../../data/repositories/node-metrics-repository', () => ({
    NodeMetricsRepository: class { insertSamples = async () => undefined; purge = async () => 0; },
}));
jest.mock('../../services/agent-task/task-queue', () => ({ getAgentTaskQueue: () => ({ stats: () => ({}) }) }));
jest.mock('../../monitoring/slo-runner', () => ({ runSloTick: async () => undefined }));
jest.mock('../../data/repositories/slo-repository', () => ({ SloRepository: class { purge = async () => 0; } }));
jest.mock('../../monitoring/alerts', () => ({ getAlertSystem: () => ({ sendAlert: jest.fn() }) }));
jest.mock('../../services/agent-task/hitl-park', () => ({ sweepParkedTasks: async () => undefined, expireParkedTasks: async () => undefined }));
jest.mock('../../services/agent-task/boot-recovery', () => ({
    sweepExpiredTaskLeases: async () => undefined,
    recoverInterruptedAgentTasks: async () => ({ resumed: 0, failed: 0 }),
}));
jest.mock('../../services/agent-task/schedule-runner', () => ({ startAgentTaskScheduleScheduler: () => setInterval(() => undefined, 60_000) }));
jest.mock('../../services/agent-task/upload-retention', () => ({ sweepExpiredTaskUploads: async () => ({ sweptTasks: 0, orphanDirs: 0, tmpFiles: 0 }) }));
jest.mock('../../services/agent-task/chunk-store', () => ({ cleanupStaleChunkUploads: async () => undefined }));
jest.mock('../../services/agent-task/task-retention', () => ({ sweepAgentTaskRetention: async () => undefined }));
jest.mock('../../data/repositories/artifact-execution-repository', () => ({
    ArtifactExecutionRepository: class { deleteOlderThan = async () => 0; },
}));
jest.mock('../../monitoring/gate-report', () => ({ startGateReportScheduler: () => setInterval(() => undefined, HOUR) }));
jest.mock('../../agents/learning', () => ({
    getAgentLearningSystem: () => ({ hydrateFromDb: async () => undefined, runSelfImprovementCycle: async () => ({ suggestions: 0, improvedAgents: [] }) }),
}));

import { startAllSchedulers, stopAllSchedulers } from '../index';
import { stopPeriodicCleanup } from '../../utils/token-cleanup';

describe('stopAllSchedulers — 타이머 잔존', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    test('startAllSchedulers 가 건 타이머를 전부 멈춘다', async () => {
        const setIntervalSpy = jest.spyOn(global, 'setInterval');
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        await startAllSchedulers();
        const started = [...setIntervalSpy.mock.results, ...setTimeoutSpy.mock.results].map((r) => r.value as NodeJS.Timeout);
        // 등록이 실제로 일어났는지 — 플래그를 전부 켠 구성에서 주기 타이머만 20개가 넘는다
        expect(setIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(20);

        const clearSpy = jest.spyOn(global, 'clearInterval');
        stopAllSchedulers();
        const cleared = new Set(clearSpy.mock.calls.map((c) => c[0]));
        const left = started.filter((t) => !cleared.has(t));
        for (const t of left) clearInterval(t); // 실패해도 테스트 프로세스에 타이머를 남기지 않는다
        expect(left).toHaveLength(0);
    });

    test('토큰 정리(자체 타이머)를 중지한다', () => {
        stopAllSchedulers();
        expect(stopPeriodicCleanup).toHaveBeenCalled();
    });
});
