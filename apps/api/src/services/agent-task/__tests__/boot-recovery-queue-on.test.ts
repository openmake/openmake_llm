/**
 * 동시성 큐 운영 기본 ON(W3 R1) — 운영(NODE_ENV=production)은 미설정이면 큐가 켜지고, 명시 false 는 끈다.
 * 큐가 켜지면 부팅 복구도 dispatchAgentTask 를 거쳐 전역 상한을 지킨다(상한 초과분은 'queued' 로 기록) — 복구 코드 변경 없이 테스트로 고정.
 * task-queue 는 실제 모듈을 쓴다.
 */
export {};

const updateAgentTask = jest.fn(async (..._a: unknown[]) => undefined);
const claim = jest.fn(async () => true);
const interrupted: unknown[] = [];
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ updateAgentTask, getAgentTaskSteps: async () => [], getUserById: async () => ({ role: 'user' }) }),
    getPool: () => ({}),
}));
jest.mock('../../../data/repositories/agent-task-repository', () => ({
    AgentTaskRepository: jest.fn().mockImplementation(() => ({ getInterruptedAgentTasks: async () => interrupted, claimAgentTaskForRecovery: claim })),
}));
jest.mock('../../../data/repositories/agent-task-run-repository', () => ({
    AgentTaskRunRepository: jest.fn().mockImplementation(() => ({ countRecoveriesWithoutProgress: async () => 0 })),
}));
// 실행은 끝나지 않는다 — 시작된 작업이 전역 슬롯을 계속 잡고 있게
const execute = jest.fn(() => new Promise<void>(() => undefined));
jest.mock('../../AgentTaskService', () => ({ AgentTaskService: Object.assign(jest.fn().mockImplementation(() => ({ execute })), { isRunning: () => false }) }));

const ENV_KEYS = ['NODE_ENV', 'AGENT_TASK_QUEUE_ENABLED', 'AGENT_TASK_QUEUE_GLOBAL_MAX'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

function loadLimits(nodeEnv: string, raw?: string): typeof import('../../../config/runtime-limits-agent-task').AGENT_TASK_LIMITS {
    jest.resetModules();
    process.env.NODE_ENV = nodeEnv;
    if (raw === undefined) delete process.env.AGENT_TASK_QUEUE_ENABLED;
    else process.env.AGENT_TASK_QUEUE_ENABLED = raw;
    return (require('../../../config/runtime-limits-agent-task') as typeof import('../../../config/runtime-limits-agent-task')).AGENT_TASK_LIMITS;
}

describe('AGENT_TASK_LIMITS.QUEUE_ENABLED — 운영 기본 ON', () => {
    it('운영에서 미설정이면 켜지고, false 를 명시하면 꺼진다', () => {
        expect(loadLimits('production').QUEUE_ENABLED).toBe(true);
        expect(loadLimits('production', 'false').QUEUE_ENABLED).toBe(false);
    });

    it('dev/test 는 미설정이면 꺼진 채이고, true 를 명시하면 켜진다', () => {
        expect(loadLimits('test').QUEUE_ENABLED).toBe(false);
        expect(loadLimits('development', 'true').QUEUE_ENABLED).toBe(true);
    });
});

it('운영 기본(큐 ON)·전역 상한 1 에서 중단 작업 3개를 복구하면 1개만 시작하고 2개는 queued 로 기록한다', async () => {
    process.env.AGENT_TASK_QUEUE_GLOBAL_MAX = '1';
    const limits = loadLimits('production');
    expect(limits.QUEUE_ENABLED).toBe(true);
    expect(limits.QUEUE_GLOBAL_MAX).toBe(1);
    // 큐 설정은 위에서 운영 값으로 이미 읽혔다(모듈 캐시) — 나머지 모듈은 운영 설정 검증(COOKIE_SECURE 등) 없이 test 로 읽는다
    process.env.NODE_ENV = 'test';
    const { recoverInterruptedAgentTasks } = require('../boot-recovery') as typeof import('../boot-recovery');
    const checkpoint = { conversation: [{ role: 'user', content: 'x' }], completedTurn: 1 };
    for (const id of ['boot-on-1', 'boot-on-2', 'boot-on-3']) {
        interrupted.push({ id, user_id: `u-${id}`, goal: '목표', max_turns: 10, executor: 'server', input_files: null, input_images: null, status: 'running', checkpoint });
    }

    await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 3, failed: 0 });
    expect(claim).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'boot-on-1' }));
    const queued = updateAgentTask.mock.calls.filter(([, patch]) => (patch as { status?: string }).status === 'queued').map(([id]) => id);
    expect(queued).toEqual(['boot-on-2', 'boot-on-3']);
});
