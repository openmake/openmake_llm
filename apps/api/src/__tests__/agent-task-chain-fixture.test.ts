/**
 * 장기 실행 체인(188) — 상한에 닿은 실행 루프가 후속 작업을 만들고, 후속이 인계 시드로 이어서 돌고, 예산이 다하면 멈추는 전 구간.
 *
 * 단위 테스트(continuation·continuation-hook·turn-gate-continuation)는 구간마다 따로 본다. 여기서는 interrupt-resume fixture 와
 * 같은 방식으로 실제 실행 루프(AgentTaskService)·실제 디스패치(task-queue)·실제 종료 정리·부팅 복구·모델 대기 스윕을 그대로 쓰고,
 * 모델은 가짜 LLM 서버에 실제 LLMClient 로 붙인다. DB 만 메모리 저장소(작업 행 여러 개 — 체인은 후속 행을 새로 만든다)로 바꾼다.
 *
 * 범위 밖: TASK_SANDBOX_ENABLED=false 라 taskRuntime 이 null — 작업 공간 스냅숏·복원(prepareSegmentWorkspace, 파일 이어받기)은
 * 지나가지 않는다(라이브로만 확인됨).
 */
import { startLlmFixture, sseChunk, type FixtureReply, type LlmFixture } from './utils/llm-fixture-server';

// ── 메모리 저장소: 작업 행 여러 개·작업별 단계 기록 — 실행 루프·이어가기·복구·재개가 같은 것을 읽고 쓴다 ──
type Row = Record<string, unknown> & { id: string; status: string };
const store = {
    rows: new Map<string, Row>(), steps: new Map<string, Array<Record<string, unknown>>>(),
    inFlight: new Map<string, string | null>(), parked: new Map<string, string>(), events: [] as string[], seq: 0,
};
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const column = (k: string): string => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
// 실제 DB 처럼 읽을 때마다 새 객체 — 실행 루프가 들고 있는 행(체인 컨텍스트)은 저장소가 바뀌어도 그대로다
const clone = <T>(v: T): T => structuredClone(v);
const rowOf = (id: string): Row => { const r = store.rows.get(id); if (!r) throw new Error(`행 없음: ${id}`); return r; };
const stepsOf = (id: string): Array<Record<string, unknown>> => { if (!store.steps.has(id)) store.steps.set(id, []); return store.steps.get(id)!; };
function newRow(fields: Partial<Row> & { id: string }): Row {
    return {
        status: 'pending', user_id: 'u1', goal: GOAL, max_turns: 10, executor: 'sandbox', priority: 0, checkpoint: null, plan: null, error: null,
        total_tokens: 0, chain_root_task_id: null, continued_from_task_id: null, continued_by_task_id: null, long_running: null, continuation: null,
        created_at: new Date(Date.now() + store.seq++), updated_at: new Date(), ...fields,
    };
}
const fakeDb = {
    getAgentTask: async (id: string) => { const r = store.rows.get(id); return r ? clone(r) : undefined; },
    updateAgentTask: async (id: string, u: Record<string, unknown>) => {
        const r = store.rows.get(id);
        if (!r) return;
        for (const [k, v] of Object.entries(u)) r[column(k)] = clone(v);
        r.updated_at = new Date();
        if (typeof u.status === 'string') { store.events.push(`${id}:${u.status}`); if (TERMINAL.has(u.status)) r.completed_at = new Date(); }
    },
    // 실제 구현(AgentTaskRepository.createAgentTask)은 INSERT 뒤 true 를 돌려준다(멱등 키 중복일 때만 false)
    createAgentTask: async (p: Record<string, unknown> & { id: string }) => {
        store.rows.set(p.id, newRow({
            id: p.id, user_id: p.userId, goal: p.goal, max_turns: p.maxTurns ?? 10, executor: p.executor ?? 'sandbox',
            input_files: p.inputFiles ?? null, input_images: p.inputImages ?? null, device_id: p.deviceId ?? null, folder_rel: p.folderRel ?? null,
            chain_root_task_id: p.chainRootTaskId ?? null, continued_from_task_id: p.continuedFromTaskId ?? null,
            long_running: clone(p.longRunning ?? null), continuation: clone(p.continuation ?? null),
        }));
        return true;
    },
    addAgentTaskStep: async (s: Record<string, unknown>) => { stepsOf(String(s.taskId)).push(s); },
    deleteAgentTaskSteps: async (id: string) => { store.steps.set(id, []); },
    getAgentTaskSteps: async (id: string) => [...stepsOf(id)],
    getUserById: async () => ({ role: 'user' }),
};
jest.mock('../data/models/unified-database', () => ({ getUnifiedDatabase: () => fakeDb, getPool: () => ({}) }));

/** 이름 붙인 동작만 저장소에 닿고, 나머지 저장소 메서드는 아무 일도 하지 않는다(관측·이력 기록). */
const repoOf = (impl: Record<string, (...a: never[]) => unknown>) => new Proxy(impl, {
    get: (t, k: string) => t[k] ?? (async () => undefined),
});
const restartMarked = (r: Row): boolean => r.status === 'failed' && r.error === 'server restarted';
jest.mock('../data/repositories/agent-task-repository', () => ({
    ...jest.requireActual('../data/repositories/agent-task-repository'),
    AgentTaskRepository: jest.fn().mockImplementation(() => repoOf({
        getInterruptedAgentTasks: async () => [...store.rows.values()].filter(restartMarked).map(clone),
        claimAgentTaskForRecovery: async (id: never) => {
            const r = rowOf(id);
            if (!restartMarked(r)) return false;
            Object.assign(r, { status: 'pending', error: null, completed_at: null });
            return true;
        },
        markParked: async (id: never, reason: never) => { store.parked.set(id, reason); },
        listParkedTasks: async () => [...store.rows.values()].filter((r) => r.status === 'paused' && store.parked.has(r.id)).map((r) => (
            { id: r.id, user_id: r.user_id, device_id: null, workspace_path: null, reason: store.parked.get(r.id), waited_ms: '0', has_decision: false, has_live_pending: false })),
        claimParkedTask: async (id: never) => {
            const r = rowOf(id);
            if (!(r.status === 'paused' && store.parked.has(id))) return false;
            store.parked.delete(id); r.status = 'pending';
            return true;
        },
        markForked: async (id: never, from: never, turn: never) => { Object.assign(rowOf(id), { forked_from_task_id: from, forked_from_turn: turn }); },
        // 이어가기 후속의 원자적 생성(#1473) — 실제 SQL 처럼 선점(continued_by 가 비어 있을 때만)과 완전한 후속 행을 함께 쓴다
        createContinuationSuccessor: async (seed: never) => {
            const s = seed as unknown as { parentTaskId: string; create: Record<string, unknown> & { id: string }; checkpoint: unknown; plan?: unknown; forkedFromTurn: number; approvalPolicy?: string; thinkingLevel?: string; lease?: { owner: string } };
            const parent = rowOf(s.parentTaskId);
            if (parent.continued_by_task_id != null) return false;
            parent.continued_by_task_id = s.create.id;
            await fakeDb.createAgentTask(s.create);
            Object.assign(rowOf(s.create.id), {
                checkpoint: clone(s.checkpoint), plan: clone(s.plan ?? null), forked_from_task_id: s.parentTaskId, forked_from_turn: s.forkedFromTurn,
                approval_policy: s.approvalPolicy ?? null, thinking_level: s.thinkingLevel ?? null, lease_owner: s.lease?.owner ?? null,
            });
            return true;
        },
    })),
}));
// 턴 재진입 기록(실행 중 호출·도구 결과 저널)은 체크포인트 저장소로 분리됐다 — 같은 Map 위에서 구현
jest.mock('../data/repositories/agent-task-checkpoint-repository', () => ({
    AgentTaskCheckpointRepository: jest.fn().mockImplementation(() => repoOf({
        setInFlightToolCall: async (id: never, callId: never) => { store.inFlight.set(id, callId); },
        getInFlightToolCall: async (id: never) => store.inFlight.get(id) ?? null,
        getToolCallJournal: async (id: never, ids: never) => new Map(stepsOf(id)
            .filter((s) => s.stepType === 'tool_result' && (ids as string[]).includes(String(s.toolCallId)))
            .map((s) => [String(s.toolCallId), String(s.content)])),
    })),
}));
// 체인 저장소 — 실제 SQL 의 조건(선점 되돌리기는 그 후속일 때만, 취소 표식은 long_running 병합)을 그대로 옮긴다. 선점은 위 createContinuationSuccessor
jest.mock('../data/repositories/agent-task-chain-repository', () => ({
    ...jest.requireActual('../data/repositories/agent-task-chain-repository'),
    AgentTaskChainRepository: jest.fn().mockImplementation(() => ({
        resetContinuation: async (from: string, successor: string) => { const r = rowOf(from); if (r.continued_by_task_id === successor) r.continued_by_task_id = null; },
        markChainCancelled: async (rootId: string) => { const r = rowOf(rootId); r.long_running = { ...(r.long_running as object ?? {}), cancelled: true }; },
        listChain: async (rootId: string) => [...store.rows.values()].filter((r) => r.chain_root_task_id === rootId)
            .sort((a, b) => (a.created_at as Date).getTime() - (b.created_at as Date).getTime()).map(clone),
    })),
}));
jest.mock('../data/repositories/agent-task-run-repository', () => ({
    ...jest.requireActual('../data/repositories/agent-task-run-repository'),
    AgentTaskRunRepository: jest.fn().mockImplementation(() => repoOf({ countRecoveriesWithoutProgress: async () => 0 })),
}));
jest.mock('../data/repositories/agent-task-park-repository', () => ({
    AgentTaskParkRepository: jest.fn().mockImplementation(() => repoOf({
        getParkReason: async (id: never) => (store.rows.get(id)?.status === 'paused' ? store.parked.get(id) ?? null : null),
        setApprovalPolicy: async (id: never, v: never) => { rowOf(id).approval_policy = v; },
        setThinkingLevel: async (id: never, v: never) => { rowOf(id).thinking_level = v; },
    })),
}));

// ── 모델: 실제 LLMClient 를 가짜 서버에 붙인다(쿼터 예약·SDK 자체 재시도만 끈다) ──
let fixture: LlmFixture;
jest.mock('../llm', () => {
    const actual = jest.requireActual('../llm');
    return { ...actual, createClient: (cfg: Record<string, unknown> = {}) => new actual.LLMClient({ ...cfg, baseUrl: fixture.baseURL, apiKey: 'fixture', quotaExempt: true, maxRetries: 0 }) };
});
jest.mock('../config/model-roles', () => ({ ...jest.requireActual('../config/model-roles'), getModelForRole: () => 'fixture-model' }));
jest.mock('../services/cost/cost-ledger-service', () => ({ ...jest.requireActual('../services/cost/cost-ledger-service'), recordLlmCost: jest.fn() }));
jest.mock('../utils/event-bus', () => ({ emitAgentTaskProgress: jest.fn() }));
jest.mock('../services/PushService', () => ({ getPushService: () => ({ sendPush: jest.fn().mockResolvedValue(undefined) }) }));
jest.mock('../services/agent-task/task-lease', () => ({
    ...jest.requireActual('../services/agent-task/task-lease'),
    beginTaskLease: async () => ({ acquired: true, end: async () => undefined }),
}));

// ── 도구: 읽기 도구(web_search) 하나. 테스트가 호출마다 결과(또는 끝나지 않는 호출)를 정한다 ──
jest.mock('../addon-host/contributions', () => ({ ...jest.requireActual('../addon-host/contributions'), contributedToolRisk: () => ({ web_search: 'read' }) }));
const executeTool = jest.fn();
jest.mock('../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({
        listLLMTools: jest.fn().mockResolvedValue([{ type: 'function', function: { name: 'web_search', description: 'web_search', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }]),
        listTools: jest.fn().mockResolvedValue([]),
        executeTool: (...a: unknown[]) => executeTool(...a),
        getUserToolGroups: () => [],
        normalizeToolCall: (name: string, args: Record<string, unknown>) => ({ name, args }),
        callUserServerTool: jest.fn().mockResolvedValue(null),
        runWithUserInputContext: (_c: unknown, fn: () => unknown) => fn(),
        ensureUserToolsForTask: jest.fn().mockResolvedValue(undefined),
        releaseUserToolsForTask: jest.fn().mockResolvedValue(undefined),
        onUserLogin: jest.fn(), onUserLogout: jest.fn(), onChatStart: jest.fn(), onChatEnd: jest.fn(), onServerReady: jest.fn(), shutdown: jest.fn(),
    }),
}));
jest.mock('../runtime-ports/skill-runtime', () => ({
    ...jest.requireActual('../runtime-ports/skill-runtime'),
    getSkillRuntime: () => ({ buildProceduralSkillBlock: async () => '', proceduralHooks: () => undefined,
        buildManifestPrompt: jest.fn().mockResolvedValue(null), getActiveSkillBindings: jest.fn().mockResolvedValue([]),
        getSkillsForAgent: jest.fn().mockResolvedValue([]), buildSkillPrompt: jest.fn().mockResolvedValue(''),
        buildSkillPromptForIds: jest.fn().mockResolvedValue(''), searchActiveSkills: jest.fn().mockResolvedValue([]),
        applyCatalogToTools: async (tools: unknown) => tools, recordUsage: () => { /* no-op */ }, isOfferEnabled: () => false,
    }),
}));

process.env.TASK_SANDBOX_ENABLED = 'false';
process.env.AGENT_TASK_QUEUE_ENABLED = 'false';
process.env.AGENT_TASK_TURN_RETRY_BACKOFF_MS = '1';
process.env.AGENT_TASK_RECOVERY_WAIT_BASE_MS = '1';
process.env.AGENT_TASK_RECOVERY_WAIT_CAP_MS = '1';
// AGENT_TASK_LONG_RUNNING 은 생성 라우트 게이트(longRunningCreateGate)만 본다 — 루프는 행의 long_running 만 보므로 켜지 않는다.

import { AgentTaskService } from '../services/AgentTaskService';
import { dispatchAgentTask, getAgentTaskQueue } from '../services/agent-task/task-queue';
import { drainAgentTasksForShutdown, resetAgentTaskShutdownForTest } from '../services/agent-task/shutdown-drain';
import { recoverInterruptedAgentTasks } from '../services/agent-task/boot-recovery';
import { sweepModelWaitTasks } from '../services/agent-task/model-wait';
import { AgentTaskChainRepository } from '../data/repositories/agent-task-chain-repository';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';
import { AGENT_TASK_LONG_RUNNING } from '../config/agent-task-long-running';
import { HANDOFF_SUMMARY_MARKER } from '../prompts/agent-task-context';
import { CONTINUATION_NEXT_STEPS_HEADING, getContinuationNextStepsPrompt, getContinuationNotice } from '../prompts/agent-task-continuation';

const GOAL = '오늘의 날씨를 여러 번 검색해서 한 문장으로 알려 줘';
const FINAL = '검색 결과에 따르면 오늘은 맑습니다. 요청하신 내용을 한 문장으로 정리했습니다.';
const NEXT_STEPS = '1. 남은 지역의 날씨를 검색한다\n2. 결과를 한 문장으로 정리한다';
/** 인계 턴 질문 — 사유별 문구라 이 테스트가 쓰는 사유(turns·tokens)의 둘 다 인계로 본다 */
const HANDOFF_PROMPTS = new Set(['turns', 'tokens'].map((r) => getContinuationNextStepsPrompt(AGENT_TASK_LONG_RUNNING.HANDOFF_TURN_MAX_CHARS, r)));
const ROOT = 'root';
type Msg = { role: string; content?: unknown; tool_calls?: Array<Record<string, unknown>>; tool_call_id?: string };
type Body = Record<string, unknown> & { messages?: Msg[]; tools?: unknown[] };

const toolCallReply = (n: number): FixtureReply => ({ kind: 'stream', chunks: [
    sseChunk({ role: 'assistant', content: '' }),
    sseChunk({ tool_calls: [{ index: 0, id: `call_${n}`, type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: `날씨 ${n}` }) } }] }),
    sseChunk({}, { finish_reason: 'tool_calls', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
] });
const textReply = (text: string): FixtureReply => ({ kind: 'stream', chunks: [
    sseChunk({ role: 'assistant', content: text }),
    sseChunk({}, { finish_reason: 'stop', usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }),
] });
/** 스트리밍이 아닌 요청에는 같은 내용을 JSON 으로 준다. */
const asRequested = (body: Body, r: FixtureReply): FixtureReply => {
    if (body.stream || r.kind !== 'stream') return r;
    const message: Record<string, unknown> = { role: 'assistant', content: '' };
    let finish = 'stop';
    let usage: unknown;
    for (const c of r.chunks) {
        const choice = (c.choices as Array<{ delta: Record<string, unknown>; finish_reason: string | null }>)[0];
        if (typeof choice.delta.content === 'string') message.content = String(message.content) + choice.delta.content;
        if (choice.delta.tool_calls) message.tool_calls = (choice.delta.tool_calls as Array<Record<string, unknown>>).map(({ index: _i, ...tc }) => tc);
        if (choice.finish_reason) finish = choice.finish_reason;
        if (c.usage) usage = c.usage;
    }
    return { kind: 'json', body: { id: 'chatcmpl-fixture', object: 'chat.completion', model: 'fixture', choices: [{ index: 0, message, finish_reason: finish }], usage } };
};

// ── 요청 분류: 작업 대화(두 번째 메시지가 목표)인가, 도구를 실어 보냈나, 인계 턴인가, 몇 번째 세그먼트인가 ──
const text = (m: Msg | undefined): string => (typeof m?.content === 'string' ? m.content : '');
const msgs = (b: Body): Msg[] => b.messages ?? [];
const isTaskConv = (b: Body): boolean => text(msgs(b)[1]) === GOAL;
const hasTools = (b: Body): boolean => Array.isArray(b.tools) && b.tools.length > 0;
const isHandoff = (b: Body): boolean => isTaskConv(b) && HANDOFF_PROMPTS.has(text(msgs(b).at(-1)));
/** 후속 세그먼트의 대화 — 시드의 세 번째 메시지가 인계 요약이고 끝에 "세션 N" 안내가 붙는다. 루트는 0. */
const segmentOf = (b: Body): number => {
    const seed = text(msgs(b)[2]);
    if (!seed.startsWith(HANDOFF_SUMMARY_MARKER)) return 0;
    for (let i = 1; i <= AGENT_TASK_LONG_RUNNING.MAX_SEGMENTS; i++) if (seed.endsWith(getContinuationNotice(i, 'turns'))) return i;
    return -1;
};
const reqs = (): Body[] => fixture.requests as Body[];
const agentTurns = (): Body[] => reqs().filter((b) => isTaskConv(b) && hasTools(b));
const handoffs = (): Body[] => reqs().filter(isHandoff);

/** 모델 장애 — 참인 요청에 503(모델 대기 시험). */
let down: (b: Body) => boolean = () => false;

async function waitFor(what: string, pred: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!(await pred())) {
        if (Date.now() > until) {
            const rows = [...store.rows.values()].map((r) => `${r.id}=${r.status}/${r.completion_path ?? '-'}`).join(', ');
            throw new Error(`기다리다 시간 초과: ${what} (행 ${rows}, 모델 요청 ${reqs().length}건, 도구 호출 ${executeTool.mock.calls.length}건)`);
        }
        await new Promise((r) => setTimeout(r, 20));
    }
}
/** 체인 순서대로 — 루트에서 continued_by 를 따라간다. */
function chain(): Row[] {
    const out: Row[] = [];
    for (let r = store.rows.get(ROOT); r; r = r.continued_by_task_id ? store.rows.get(String(r.continued_by_task_id)) : undefined) out.push(r);
    return out;
}
const successorOf = (id: string): Row | undefined => [...store.rows.values()].find((r) => r.continued_from_task_id === id);
const queueIdle = (): boolean => [...store.rows.keys()].every((id) => !getAgentTaskQueue().has(id));
const stepTypes = (id: string): string[] => stepsOf(id).map((s) => String(s.stepType));

/** 루트 행 — 생성 라우트의 longRunningCreateGate 가 넣는 것과 같은 모양을 저장소에 직접 둔다. */
function seedRoot(maxSegments: number, extra: Partial<Row> = {}): void {
    store.rows.set(ROOT, newRow({
        id: ROOT, max_turns: 3, chain_root_task_id: ROOT,
        long_running: { maxDurationMs: 60 * 60 * 1000, maxTotalTokens: 5_000_000, maxSegments, startedAt: Date.now() }, ...extra,
    }));
}
/** 라우트의 /execute 와 같은 시작 — claim 뒤 디스패치. */
function startRoot(extra: Record<string, unknown> = {}): void {
    void dispatchAgentTask({ taskId: ROOT, userId: 'u1', run: () => new AgentTaskService().execute({ taskId: ROOT, userId: 'u1', userRole: 'user', goal: GOAL, maxTurns: 3, ...extra } as never) });
}
/** 도구 결과 — n 번째 호출(1부터)에 hang 을 주면 그 호출만 끝나지 않거나 hang 이 풀릴 때 끝난다. */
function toolResults(hangAt?: { n: number; until?: Promise<void> }): void {
    let n = 0;
    executeTool.mockImplementation(async () => {
        n++;
        if (hangAt && n === hangAt.n) await (hangAt.until ?? new Promise(() => { /* 종료 때까지 끝나지 않는다 */ }));
        return { content: [{ type: 'text', text: `맑음 ${n}` }] };
    });
}
/** 프로세스가 내려갔다 다시 뜬 것처럼 — 종료 정리 뒤 메모리 상태(종료 표시)를 새 프로세스의 것으로 되돌린다. */
async function restartServer(): Promise<{ aborted: number; remaining: number }> {
    const drained = await drainAgentTasksForShutdown(3000);
    await waitFor('종료 정리 뒤 큐 자리 반납', queueIdle);
    resetAgentTaskShutdownForTest();
    return drained;
}

beforeAll(async () => {
    fixture = await startLlmFixture((_i, raw) => {
        const b = raw as Body;
        if (down(b)) return { kind: 'error', status: 503 };
        if (!isTaskConv(b)) return asRequested(b, textReply('{"verdict":"achieved","reason":"목표를 달성했습니다."}')); // 완료 판정 등
        if (hasTools(b)) return asRequested(b, toolCallReply(agentTurns().length)); // 매 에이전트 턴 검색 — 세그먼트가 진행을 남긴다
        return asRequested(b, textReply(isHandoff(b) ? NEXT_STEPS : FINAL)); // 인계 턴은 다음에 할 일, 마무리 턴은 최종 답
    });
});
afterAll(async () => { await fixture.close(); });
beforeEach(() => {
    store.rows.clear(); store.steps.clear(); store.inFlight.clear(); store.parked.clear(); store.events.length = 0;
    fixture.requests.length = 0;
    down = () => false;
    executeTool.mockReset();
    resetAgentTaskShutdownForTest();
});
// 실패로 끝나도 실행이 남지 않게 — 모든 작업을 취소하고 큐가 비기를 기다린다
afterEach(async () => {
    for (const id of store.rows.keys()) AgentTaskService.cancel(id);
    await waitFor('남은 실행 정리', queueIdle);
});

describe('장기 실행 체인 — 이어가기·복구·취소·폭주 가드 (실제 루프·큐·복구·스윕, 가짜 LLM 서버)', () => {
    it('턴 상한에서 root→s1→s2 로 잇고, 세그먼트 예산(3)이 다하면 마지막 세그먼트는 종전 마무리 턴으로 끝난다', async () => {
        seedRoot(3);
        toolResults();
        startRoot();
        await waitFor('세 세그먼트가 끝남', () => chain().length === 3 && TERMINAL.has(chain()[2].status) && queueIdle());

        const [root, s1, s2] = chain();
        expect(store.rows.size).toBe(3); // 더 만들지 않았다
        for (const [seg, prev] of [[s1, root], [s2, s1]] as const) {
            expect(seg).toMatchObject({ chain_root_task_id: ROOT, continued_from_task_id: prev.id, forked_from_task_id: prev.id, max_turns: 3 });
            expect(seg.continuation).toMatchObject({ fromTaskId: prev.id, reason: 'turns' });
        }
        const c1 = s1.continuation as { segmentIndex: number; chainUsedTokens: number; summary: string };
        const c2 = s2.continuation as typeof c1;
        expect([c1.segmentIndex, c2.segmentIndex]).toEqual([1, 2]);
        // 체인 누적 토큰 — 루트 두 턴(15×2), 그 위에 s1 두 턴이 쌓인다
        expect(c1.chainUsedTokens).toBe(30);
        expect(c2.chainUsedTokens).toBe(60);
        expect(c1.summary.startsWith(HANDOFF_SUMMARY_MARKER)).toBe(true);
        expect(c1.summary).toContain(`${CONTINUATION_NEXT_STEPS_HEADING}\n${NEXT_STEPS}`);

        // 루트·s1 은 '이어짐' 으로 마감, s2 는 예산 소진 — 더 잇지 못하고 종전 마무리 턴(도구 차단)으로 끝난다
        for (const [seg, next] of [[root, s1], [s1, s2]] as const) expect(seg).toMatchObject({ status: 'completed', completion_path: 'continued', continued_by_task_id: next.id });
        expect(s2.status).toBe('completed');
        expect(s2.completion_path).not.toBe('continued');
        expect(s2.continued_by_task_id).toBeNull();
        expect(String(s2.result)).toContain('맑습니다');
        expect(stepTypes(s2.id)).toContain('final_turn');
        expect(stepTypes(ROOT)).not.toContain('final_turn');
        expect(stepTypes(s1.id)).not.toContain('final_turn');

        // 인계 턴은 루트·s1 에서 한 번씩, 도구 없이
        expect(handoffs()).toHaveLength(2);
        for (const h of handoffs()) expect(hasTools(h)).toBe(false);
        expect(handoffs().map(segmentOf)).toEqual([0, 1]);
        // 세그먼트마다 에이전트 턴 두 번(턴 0·1), 턴 2 에서 잇거나 마무리
        expect(agentTurns().map(segmentOf)).toEqual([0, 0, 1, 1, 2, 2]);
        // 후속의 첫 에이전트 턴은 [원 system, 목표, 인계 요약+안내] 로 시작한다
        for (const [i, seg] of [[1, s1], [2, s2]] as const) {
            const first = msgs(agentTurns().find((b) => segmentOf(b) === i)!);
            expect(first.slice(0, 3).map((m) => m.role)).toEqual(['system', 'user', 'user']);
            expect(first[0]).toEqual(msgs(agentTurns()[0])[0]);
            expect(text(first[1])).toBe(GOAL);
            expect(text(first[2])).toBe(`${(seg.continuation as typeof c1).summary}\n\n${getContinuationNotice(i, 'turns')}`);
        }
        // s2 의 마지막 요청은 도구 없는 마무리 턴(인계 턴 아님)
        const last = reqs().filter((b) => isTaskConv(b) && segmentOf(b) === 2).at(-1)!;
        expect(hasTools(last)).toBe(false);
        expect(isHandoff(last)).toBe(false);
    });

    it('후속 세그먼트의 도구 실행 중 서버가 종료되면: 부팅 복구가 같은 후속을 체인 정보 그대로 이어서 완료하고, 루트는 건드리지 않는다', async () => {
        seedRoot(2);
        toolResults({ n: 3 }); // 루트의 두 호출 뒤 s1 의 첫 호출이 끝나지 않는다
        startRoot();
        await waitFor('s1 의 첫 도구 호출 시작', () => executeTool.mock.calls.length === 3 && successorOf(ROOT)?.status === 'running');
        const s1Id = successorOf(ROOT)!.id;
        const rootBefore = clone(rowOf(ROOT));
        const contBefore = clone(rowOf(s1Id).continuation);
        expect(rootBefore).toMatchObject({ status: 'completed', completion_path: 'continued', continued_by_task_id: s1Id });

        await expect(restartServer()).resolves.toEqual({ aborted: 1, remaining: 0 });
        expect(rowOf(s1Id)).toMatchObject({ status: 'failed', error: 'server restarted', chain_root_task_id: ROOT, continued_from_task_id: ROOT });

        await expect(recoverInterruptedAgentTasks()).resolves.toEqual({ resumed: 1, failed: 0 });
        await waitFor('복구된 s1 완료', () => rowOf(s1Id).status === 'completed' && queueIdle());

        const s1 = rowOf(s1Id);
        expect(s1.chain_root_task_id).toBe(ROOT);
        expect(s1.continuation).toEqual(contBefore);
        expect(s1.completion_path).not.toBe('continued'); // 세그먼트 예산 2 — s1 이 마지막
        expect(String(s1.result)).toContain('맑습니다');
        expect(store.rows.size).toBe(2);
        expect(rowOf(ROOT)).toEqual(rootBefore);
        // 끊긴 호출은 재개 때 다시 실행돼 결과가 한 번만 남는다(턴 중간 재개)
        expect(stepsOf(s1Id).filter((s) => s.stepType === 'tool_result' && s.toolCallId === 'call_3')).toHaveLength(1);
        expect(store.events).toEqual(expect.arrayContaining([`${s1Id}:failed`, `${s1Id}:completed`]));
    });

    it('체인을 취소하면: 실행 중인 후속이 상한에 닿아도 다음 세그먼트를 만들지 않고 종전 마무리로 끝난다', async () => {
        seedRoot(5);
        let release!: () => void;
        toolResults({ n: 3, until: new Promise<void>((r) => { release = r; }) });
        startRoot();
        await waitFor('s1 의 첫 도구 호출 시작', () => executeTool.mock.calls.length === 3 && successorOf(ROOT)?.status === 'running');
        const s1Id = successorOf(ROOT)!.id;

        // 라우트의 체인 취소가 하는 일 — 루트 long_running 에 cancelled 표식
        await new AgentTaskChainRepository({} as never).markChainCancelled(ROOT);
        expect(rowOf(ROOT).long_running).toMatchObject({ cancelled: true, maxSegments: 5 });
        release();
        await waitFor('s1 완료', () => TERMINAL.has(rowOf(s1Id).status) && queueIdle());

        const s1 = rowOf(s1Id);
        expect(s1.status).toBe('completed');
        expect(s1.completion_path).not.toBe('continued');
        expect(s1.continued_by_task_id).toBeNull();
        expect(store.rows.size).toBe(2); // 후속 없음
        expect(stepTypes(s1Id)).toContain('final_turn');
        expect(String(s1.result)).toContain('맑습니다');
        // s1 은 시작 때 읽은 루트(취소 전)로 판정해 인계 턴까지는 가고, 선점 직전의 루트 재조회가 취소를 잡는다
        expect(handoffs().map(segmentOf)).toEqual([0, 1]);
    });

    /**
     * 폭주 가드(segmentHasProgress) — 이전 실행분 토큰을 이어 센 재개로 들어와, 이 세그먼트의 첫 턴(turn = startTurn)부터 토큰 사유에 걸린다.
     * 체인 예산(5M)은 남아 체인 판정만으로는 이어 갈 수 있다. prior: 재개 대화에 넣을 이전 실행의 assistant/tool 메시지.
     */
    async function runStalledTokenRoot(prior: Msg[]): Promise<Row> {
        const nearCap = Math.ceil(AGENT_TASK_LIMITS.MAX_TOTAL_TOKENS * AGENT_TASK_LIMITS.TOKEN_SOFT_RATIO);
        expect(nearCap).toBeLessThan(AGENT_TASK_LIMITS.MAX_TOTAL_TOKENS - 1000); // 마무리 턴 몇 번은 하드 상한 안
        seedRoot(5, { total_tokens: nearCap });
        toolResults();
        startRoot({ resume: { conversation: [{ role: 'system', content: '작업 시스템' }, { role: 'user', content: GOAL }, ...prior], fromTurn: 0, fromStep: 0 } });
        await waitFor('루트 끝남', () => TERMINAL.has(rowOf(ROOT).status) && queueIdle());
        return rowOf(ROOT);
    }
    const expectStoppedWithoutSuccessor = (root: Row): void => {
        expect(root.status).toBe('completed');
        expect(root.completion_path).not.toBe('continued');
        expect(root.continued_by_task_id).toBeNull();
        expect(store.rows.size).toBe(1);
        expect(handoffs()).toHaveLength(0); // 인계 턴도 부르지 않았다
        expect(agentTurns()).toHaveLength(0); // 첫 턴이 곧 도구 없는 마무리 턴
        expect(executeTool).not.toHaveBeenCalled();
        expect(String(stepsOf(ROOT).find((s) => s.stepType === 'final_turn')?.content)).toContain('토큰 예산');
        expect(String(root.result)).toContain('맑습니다');
    };

    it('진행 없는 세그먼트는 잇지 않는다(폭주 가드): 첫 턴부터 토큰 사유에 걸리면 후속 없이 종전 마무리 턴으로 끝난다', async () => {
        // 이전 실행이 도구를 한 번 쓴 대화 — 이번 응답이 작업의 첫 모델 응답이 아니라 마무리 턴의 답이 그대로 채택된다
        const root = await runStalledTokenRoot([
            { role: 'assistant', content: '', tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'web_search', arguments: '{"query":"날씨"}' } }] },
            { role: 'tool', tool_call_id: 'call_0', content: '맑음 0' },
        ]);
        expectStoppedWithoutSuccessor(root);
    });

    /**
     * 회귀 방지 — 체인 세그먼트의 첫 턴부터 상한 사유(tokens·context)에 걸리고, 마무리 턴의 답이 작업의 첫 모델 응답이라
     * 산출물 재촉(turn-stall 의 deliverable nudge, 단계 'plan')으로 채택되지 않아도, 다음 턴에 segmentHasProgress 가 그 도구 없는
     * 텍스트 답(assistant 메시지)을 "진행"으로 보지 않는다 — 진행은 인계 요약 뒤의 tool 메시지나 tool_calls 있는 assistant 뿐이다.
     * 종전에는 그 텍스트 답을 진행으로 보아 후속이 생겼다(로그: "진행 없음 — 이어가기 보류" 뒤 "이어가기: root → … 사유 tokens").
     */
    it('진행 없는 세그먼트의 첫 모델 응답이 재촉으로 채택되지 않아도 그 텍스트 답을 진행으로 보지 않는다', async () => {
        expectStoppedWithoutSuccessor(await runStalledTokenRoot([]));
    });

    it('후속 세그먼트에서 모델 대기로 주차돼도: 모델이 돌아온 뒤 스윕이 재개하고 체인이 다음 세그먼트로 이어진다', async () => {
        seedRoot(3);
        toolResults();
        let s1Down = true;
        down = (b) => s1Down && (segmentOf(b) === 1 || text(msgs(b)[0]) === 'ping'); // s1 의 호출과 상태 확인만 실패
        startRoot();
        await waitFor('s1 모델 대기 주차', () => {
            const s1 = successorOf(ROOT);
            return !!s1 && s1.status === 'paused' && store.parked.get(s1.id) === 'model_wait' && queueIdle();
        });
        const s1Id = successorOf(ROOT)!.id;
        expect(rowOf(s1Id).error ?? null).toBeNull();
        expect(rowOf(ROOT)).toMatchObject({ status: 'completed', completion_path: 'continued' });

        s1Down = false;
        await expect(sweepModelWaitTasks()).resolves.toEqual({ resumed: 1, expired: 0 });
        await waitFor('s2 까지 끝남', () => chain().length === 3 && TERMINAL.has(chain()[2].status) && queueIdle());

        const [, s1, s2] = chain();
        expect(s1).toMatchObject({ id: s1Id, status: 'completed', completion_path: 'continued', continued_by_task_id: s2.id });
        expect(s2.continuation).toMatchObject({ fromTaskId: s1Id, segmentIndex: 2, reason: 'turns' });
        expect(s2.status).toBe('completed');
        expect(s2.completion_path).not.toBe('continued');
        expect(store.events).not.toContain(`${s1Id}:failed`);
        expect(store.parked.size).toBe(0);
    });
});
