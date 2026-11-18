/**
 * 로컬 이어가기 세그먼트의 재개 — 서비스 배선 수준(fork-isolated-worktree r2, Fable 리뷰 지적 ①②).
 *
 * 단위 테스트(executor-select·worktree·continuation-hook·isolation-note)는 각 부품만 본다. 여기서는 실제 실행 루프(AgentTaskService)가
 *  - 이어받은 행의 continuation.worktreeKey 를 RemoteExecutor 에 넘겨 worktree add 가 앞 세그먼트 키로 나가는지,
 *  - 재개 갈래에서 체크포인트 system 의 격리 안내를 실제 브랜치로 맞추는지,
 *  - 이미 후속을 만든 세그먼트의 재실행 마감(위험 4)이 resume && local 일 때만 걸리고, 마감 갱신에 복원된 누적 토큰이 실리는지
 * 를 본다. 기기는 로컬 브리지 레지스트리를 가로채 흉내 낸다(실제 RemoteExecutor·TaskRuntime 을 그대로 쓴다).
 */
const mockChat = jest.fn(async (_conversation: { role: string; content?: unknown }[]) => (
    { role: 'assistant', content: '끝났습니다.', metrics: { prompt_tokens: 5, completion_tokens: 0 } }));
jest.mock('../llm', () => {
    const client: Record<string, unknown> = { chat: mockChat };
    client.derive = jest.fn(() => client);
    return { createClient: jest.fn(() => client) };
});
jest.mock('../config/model-roles', () => ({ ...jest.requireActual('../config/model-roles'), getModelForRole: () => 'test-model' }));
jest.mock('../utils/event-bus', () => ({ emitAgentTaskProgress: jest.fn() }));
jest.mock('../services/PushService', () => ({ getPushService: () => ({ sendPush: jest.fn().mockResolvedValue(undefined) }) }));

const rows = new Map<string, Record<string, unknown>>();
// 저장소 가짜 — 실제 저장소(agent-task-repository)처럼 전이표(task-state)를 강제한다: 표 밖 전이는 거부(throw), 허용 전이는 행 상태를 바꾼다.
const updateAgentTask = jest.fn(async (id: string, u: { status?: string }) => {
    const row = rows.get(id);
    if (!row || !u.status) return;
    const { isTransitionAllowed, AgentTaskTransitionError } = jest.requireActual('../services/agent-task/task-state');
    if (!isTransitionAllowed(row.status, u.status)) throw new AgentTaskTransitionError(id, String(row.status), u.status);
    row.status = u.status;
});
jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({
        getAgentTask: jest.fn(async (id: string) => rows.get(id)),
        updateAgentTask,
        addAgentTaskStep: jest.fn().mockResolvedValue(undefined),
        deleteAgentTaskSteps: jest.fn().mockResolvedValue(undefined),
        getAgentTaskSteps: jest.fn().mockResolvedValue([]),
        getUserById: jest.fn().mockResolvedValue({ role: 'user' }),
    }),
    getPool: () => ({}),
}));
jest.mock('../data/repositories/agent-task-chain-repository', () => ({
    AgentTaskChainRepository: jest.fn().mockImplementation(() => ({ markChainCancelled: jest.fn().mockResolvedValue(undefined) })),
}));
const mockFollow = jest.fn();
jest.mock('../services/agent-task/continuation', () => ({
    ...jest.requireActual('../services/agent-task/continuation'),
    followExistingSuccessor: (...a: unknown[]) => mockFollow(...a),
}));

// 로컬 기기 — worktree add 는 앞 세그먼트 자리를 돌려주고, 나머지 요청은 미지원으로 답한다(fail-open 경로).
const BRANCH = 'omk-task/seg1aaaa';
const WT_REL = '.openmake/worktrees/seg1';
const bridgeRequest = jest.fn(async (_u: string, p: { kind: string; op?: string }) => (
    p.kind === 'worktree' && p.op === 'add' ? { ok: true, worktreeRel: WT_REL, branch: BRANCH } : { ok: false, error: 'unsupported' }));
jest.mock('../services/local-bridge/registry', () => ({
    ...jest.requireActual('../services/local-bridge/registry'),
    getLocalBridgeRegistry: () => ({
        getDevice: () => ({ deviceId: 'd1', label: 'mac', folderName: 'repo' }),
        request: bridgeRequest,
        supports: () => false,
    }),
}));
jest.mock('../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({
        listLLMTools: jest.fn().mockResolvedValue([]),
        listTools: jest.fn().mockResolvedValue([]),
        executeTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: '결과' }] }),
        getUserToolGroups: () => [],
        normalizeToolCall: (name: string, args: Record<string, unknown>) => ({ name, args }),
        callUserServerTool: jest.fn().mockResolvedValue(null),
        runWithUserInputContext: (_c: unknown, fn: () => unknown) => fn(),
        ensureUserToolsForTask: jest.fn().mockResolvedValue(undefined),
        releaseUserToolsForTask: jest.fn().mockResolvedValue(undefined),
        onUserLogin: jest.fn(), onUserLogout: jest.fn(), onChatStart: jest.fn(), onChatEnd: jest.fn(),
        onServerReady: jest.fn(), shutdown: jest.fn(),
    }),
}));
jest.mock('../runtime-ports/skill-runtime', () => ({
    ...jest.requireActual('../runtime-ports/skill-runtime'),
    getSkillRuntime: () => ({ buildProceduralSkillBlock: async () => '', proceduralHooks: () => undefined,
        buildManifestPrompt: jest.fn().mockResolvedValue(null),
        getActiveSkillBindings: jest.fn().mockResolvedValue([]),
        getSkillsForAgent: jest.fn().mockResolvedValue([]),
        buildSkillPrompt: jest.fn().mockResolvedValue(''),
        buildSkillPromptForIds: jest.fn().mockResolvedValue(''),
        searchActiveSkills: jest.fn().mockResolvedValue([]),
        applyCatalogToTools: async (tools: unknown) => tools,
        recordUsage: () => { /* no-op */ },
        isOfferEnabled: () => false,
    }),
}));

process.env.LOCAL_EXECUTOR_ENABLED = 'true';
process.env.TASK_SANDBOX_ENABLED = 'false';
process.env.TASK_SANDBOX_CODE_DIFF_ENABLED = 'false';

import { AgentTaskService } from '../services/AgentTaskService';
import { getWorktreeIsolationNote } from '../prompts/agent-task-prompt';

const ISOLATION = { state: 'worktree', branch: BRANCH, worktreeRel: WT_REL };
const resumeOf = (system: string) => ({ conversation: [{ role: 'system', content: system }, { role: 'user', content: '목표' }], fromTurn: 1, fromStep: 3 });
const run = (over: Record<string, unknown>) => new AgentTaskService().execute({
    taskId: 'seg2', userId: 'u1', goal: '목표', maxTurns: 3, executor: 'local', deviceId: 'd1', ...over,
} as never);
const updates = (): Record<string, unknown>[] => updateAgentTask.mock.calls.filter(([id]) => id === 'seg2').map(([, u]) => u as Record<string, unknown>);

beforeEach(() => {
    jest.clearAllMocks(); rows.clear();
    rows.set('seg1', { id: 'seg1', status: 'completed', isolation: ISOLATION });
});

describe('로컬 이어가기 세그먼트 재개 — 서비스 배선', () => {
    it('이어받은 행을 재개하면 worktree add 가 물려받은 키로 나가고, system 의 격리 안내가 실제 브랜치로 바뀐다', async () => {
        rows.set('seg2', { id: 'seg2', status: 'pending', executor: 'local', continuation: { fromTaskId: 'seg1', worktreeKey: 'root-key' } });
        await run({ resume: resumeOf(`OLD SYSTEM${getWorktreeIsolationNote('omk-task/stale000')}`) });

        const adds = bridgeRequest.mock.calls.map(([, p]) => p as { kind: string; op?: string; taskId?: string }).filter((p) => p.kind === 'worktree' && p.op === 'add');
        expect(adds).toEqual([expect.objectContaining({ taskId: 'root-key' })]);
        const system = String(mockChat.mock.calls[0][0][0].content);
        expect(system.startsWith('OLD SYSTEM')).toBe(true);
        expect(system).toContain(getWorktreeIsolationNote(BRANCH, WT_REL));
        expect(system).not.toContain('omk-task/stale000');
        expect(updates().pop()).toMatchObject({ status: 'completed' });
    });

    // 재개 입력의 system 이 다른 폴더를 말할 때 — 모델은 "서버가 확인한 경로" 를 믿으므로 실제 작업 폴더(WT_REL)로 바뀌어야 한다
    it.each([
        ['fork(새 worktree, 부모 폴더 안내)', {}, getWorktreeIsolationNote('omk-task/parent00', '.openmake/worktrees/parent')],
        ['이어가기(물려받은 worktree, 옛 경로 안내)', { continuation: { fromTaskId: 'seg1', worktreeKey: 'root-key' } }, getWorktreeIsolationNote(BRANCH, '.openmake/worktrees/other')],
        ['옛 체크포인트(같은 브랜치, 경로 없는 안내)', {}, getWorktreeIsolationNote(BRANCH)],
    ])('재개 — %s 면 system 의 격리 안내가 현재 작업 폴더 경로로 바뀐다', async (_n, row, oldNote) => {
        rows.set('seg2', { id: 'seg2', status: 'pending', executor: 'local', ...row });
        await run({ resume: resumeOf(`OLD SYSTEM${oldNote}`) });

        const system = String(mockChat.mock.calls[0][0][0].content);
        expect(system).toBe(`OLD SYSTEM${getWorktreeIsolationNote(BRANCH, WT_REL)}`);
    });

    // 재실행의 시작 상태: 주차 재개·부팅 복구 claim 은 pending, /resume claim·큐 대기는 queued — 둘 다 completed 로 바로 갈 수 없다(task-state)
    it.each(['pending', 'queued'])('이미 후속을 만든 로컬 세그먼트의 재실행(%s 에서)은 도구 없이 이어짐으로 마감하고, 마감 갱신에 복원된 누적 토큰을 싣는다', async (start) => {
        rows.set('seg2', { id: 'seg2', status: start, executor: 'local', continued_by_task_id: 'seg3', total_tokens: 1234, cached_prompt_tokens: 40, cache_reported_prompt_tokens: 100 });
        mockFollow.mockResolvedValue({ successorId: 'seg3' });
        await run({ resume: resumeOf('OLD SYSTEM') });

        expect(mockFollow).toHaveBeenCalledWith('seg2', expect.anything());
        expect(mockChat).not.toHaveBeenCalled();
        expect(bridgeRequest).not.toHaveBeenCalled();
        const done = updates().find((u) => u.completionPath === 'continued');
        expect(done).toMatchObject({ status: 'completed', totalTokens: 1234, cachedPromptTokens: 40, cacheReportedPromptTokens: 100 });
        expect(updates().every((u) => u.totalTokens !== 0)).toBe(true);
        expect(rows.get('seg2')!.status).toBe('completed');
        // 전이 거부로 실패 처리되면 failed 갱신과 종료(실패) 알림 표식이 남는다 — 둘 다 없어야 한다
        expect(updates().some((u) => u.status === 'failed')).toBe(false);
        expect(updates().some((u) => u.terminalNotifyPending)).toBe(false);
    });

    it.each([
        ['재개가 아니면', { executor: 'local' }],
        ['로컬이 아니면', { executor: undefined, resume: resumeOf('OLD SYSTEM') }],
    ])('%s 재실행 마감을 하지 않는다(resume && local 관문)', async (_n, over) => {
        rows.set('seg2', { id: 'seg2', status: 'pending', continued_by_task_id: 'seg3' });
        mockFollow.mockResolvedValue({ successorId: 'seg3' });
        await run(over);

        expect(mockFollow).not.toHaveBeenCalled();
        expect(updates().some((u) => u.completionPath === 'continued')).toBe(false);
    });
});
