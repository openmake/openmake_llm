/**
 * ============================================================
 * spawn_agents 병렬 오케스트레이션 — 하위 작업 N개 병렬 위임
 * ============================================================
 *
 * Claude Code Agent tool 대응: 모델이 독립 하위 작업 N개를 병렬 서브에이전트에
 * 분담시키는 범용 오케스트레이션. 채팅(external-provider)·에이전트 작업(task-sandbox)
 * 양 경로가 이 모듈을 공용한다.
 *
 * 도구 계약은 **배열 1콜** — qwen 이 병렬 tool_calls 방출을 신뢰성 있게 못 하고
 * 도구 루프가 순차 실행이므로, tasks 배열을 받아 핸들러 내부에서 parallelBatch 로
 * 병렬화한다(runSubagent × N).
 *
 * 안전 원칙 (delegate/delegate_expert 관행 승계):
 *  - depth=1 고정: 서브 도구 서브셋에서 spawn_agents·delegate 계열 제외(재귀 구조적 불가).
 *  - 서브 도구 = 부모가 이미 실행 가능한 도구의 서브셋 — 권한 증분 0.
 *  - 에이전트 작업 경로는 승인 필요 도구를 서브셋에서 배제 — 병렬 HITL fan-in 회피(Phase 1).
 *  - 개별 태스크 실패는 해당 결과 문자열로 흡수 — 전체 fan-out 을 죽이지 않음.
 *  - 태스크 상한 초과분은 잘라내되 결과에 명시(silent cap 금지).
 *
 * @module services/agent-spawn/spawn-agents
 */
import { z } from 'zod';
import { type LLMClient } from '../../llm';
import type { ToolDefinition } from '../../llm/types';
import type { UserContext } from '../../mcp/user-sandbox';
import type { TaskSandboxConfig } from '../../config/task-sandbox';
import { AGENT_SPAWN } from '../../config/runtime-limits';
import { resolveRoleClientForUser } from '../model-role-resolver';
import { parallelBatch } from '../../workflow/graph-engine';
import { routeToAgent } from '../../agents/keyword-router';
import { getAgentSystemMessage } from '../../agents/system-prompt';
import { requiresApproval, getApprovalRegistry } from '../task-sandbox/approval-gate';
import { runSubagent } from '../agent-task/subagent';
import { SubagentTrace, newTraceId } from '../agent-task/subagent-trace';
import type { DelegateFactoryParams } from '../agent-task/delegate';
import { CHAT_DELEGATE_TOOL_NAME } from '../chat-service/chat-delegate';
import { SPAWN_AGENT_GENERIC_PROMPT } from '../../prompts/spawn-agent-system';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentSpawn');

export const SPAWN_AGENTS_TOOL_NAME = 'spawn_agents';

/** 채팅 경로의 의사 taskId — 승인 레지스트리 키로만 쓰이며 작업 행이 없으므로 활동 기록은 건너뛴다. */
export const CHAT_PSEUDO_TASK_ID = '__chat__';

/** 서브에이전트 도구 서브셋에서 제외할 위임 계열 도구 — depth=1 구조 유지(재귀 차단). */
const SUBAGENT_EXCLUDED_TOOLS = new Set([SPAWN_AGENTS_TOOL_NAME, CHAT_DELEGATE_TOOL_NAME, 'delegate']);

/** spawn_agents 도구 인자 스키마 — tasks 배열(각 태스크는 자기완결 지시 + 선택 전문 분야). */
export const spawnAgentsArgsSchema = z.object({
    tasks: z.array(z.object({
        prompt: z.string().trim().min(1),
        role: z.string().trim().min(1).optional(),
        /** 사용자 Custom Agent id — 지정 시 그 에이전트의 페르소나+model 로 실행 (Phase C) */
        agentId: z.string().trim().min(1).optional(),
    })).min(1),
});

export type SpawnTask = z.infer<typeof spawnAgentsArgsSchema>['tasks'][number];

/**
 * PURE: 모델이 자주 흘리는 인자 형태를 스키마에 맞게 감싼다(계약 유지 — 값을 버리거나
 * 바꾸지 않고 형태만 정규화). ① `tasks` 가 단일 객체면 배열로, ② `tasks` 키 없이
 * `{prompt, ...}` 를 직접 넘긴 경우 `{tasks:[그것]}` 로. 그 외는 원본을 그대로 통과시켜
 * 검증이 정상적으로 거부하게 둔다.
 */
export function normalizeSpawnArgs(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const o = raw as Record<string, unknown>;
    if (o.tasks && typeof o.tasks === 'object' && !Array.isArray(o.tasks)) {
        return { ...o, tasks: [o.tasks] };
    }
    if (!('tasks' in o) && typeof o.prompt === 'string') {
        return { tasks: [o] };
    }
    return raw;
}

/** PURE: 인자 형태 요약(키·타입만, 값 없음) — 스키마 거부 사유를 다음에 추적할 수 있게. */
export function describeArgsShape(raw: unknown): string {
    if (!raw || typeof raw !== 'object') return `${raw === null ? 'null' : typeof raw}`;
    const o = raw as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 0) return '빈 객체 {} (인자 JSON 절단·파싱 실패 가능성 — 서버 로그 "파싱 실패" 확인)';
    const t = o.tasks;
    const tasksShape = t === undefined ? '없음'
        : Array.isArray(t) ? `배열[${t.length}](첫 항목 ${t[0] === undefined ? '없음' : typeof t[0] === 'object' && t[0] !== null ? 'keys=' + Object.keys(t[0] as object).join('|') : typeof t[0]})`
        : typeof t;
    return `keys=${keys.join('|')}, tasks=${tasksShape}`;
}

/**
 * 도구 설명 — **언제 쓰는지**를 먼저 말한다. 종전 문구는 "⚠️ 쓰지 마세요"로 시작해 채택을
 * 억눌렀다(2026-08-26 자연어 6문항 기준선 실측 → 셰도우 `spawn_intent` 로 효과를 잰다).
 * 주의 문구는 유지하되 뒤로.
 */
export const SPAWN_AGENTS_TOOL_DESCRIPTION =
    '서로 독립적인 하위 작업이 2개 이상일 때 각각을 병렬 서브에이전트에게 맡겨 동시에 수행합니다 — '
    + '예: 여러 주제·대상·출처를 각각 조사해 비교하기, 여러 문서를 각각 요약하기. '
    + '각 태스크는 다른 태스크 결과를 볼 수 없으므로 자기완결적으로 서술하세요. '
    + '하나의 순차 작업이나 단순 질문에는 쓰지 말고 직접 수행하세요. 결과를 받은 뒤 직접 종합해 답하세요.';

/** 시스템 프롬프트 주입 가이드 — SPAWN_INTENT_PATTERNS 매칭 턴에만 주입한다(상시 주입 금지).
 *  description 의 보수적 경고가 과작동해 자발 채택이 0 이던 갭 보완: 병렬 의도가 명시된
 *  턴에는 "이 요청은 병렬 분담 대상"이라는 긍정 신호를 줘서 경고와 균형을 맞춘다. */
export const SPAWN_PROMPT_GUIDE =
    '\n\n[병렬 위임]\n'
    + '- 이 요청은 독립 하위 작업 병렬 처리 의도로 판단됩니다. 서로 의존하지 않는 하위 작업 '
    + '2개 이상으로 나눌 수 있으면 spawn_agents 도구로 병렬 분담하세요 — 각 태스크는 '
    + '자기완결적으로 서술하고, 결과를 받은 뒤 직접 종합해 답하세요.\n'
    + '- 하위 작업으로 나눌 수 없는 순차 작업이면 평소처럼 직접 수행하세요.';

/** spawn_agents 파라미터 JSON Schema — task-sandbox MCP 도구 정의(inputSchema)와 공유. */
export const SPAWN_AGENTS_PARAMETERS_SCHEMA: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
} = {
    type: 'object',
    properties: {
        tasks: {
            type: 'array',
            description: '병렬 수행할 독립 하위 작업 목록 (2개 이상 권장)',
            items: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: '하위 작업의 자기완결적 지시문' },
                    role: { type: 'string', description: '원하는 전문 분야(선택, 예: finance/legal/engineering)' },
                    agentId: { type: 'string', description: '사용자가 명시적으로 특정 커스텀 에이전트로 수행을 요청한 경우에만 그 에이전트 id (선택 — 임의 추측 금지)' },
                },
                required: ['prompt'],
            },
        },
    },
    required: ['tasks'],
};

/** PURE: 채팅 도구 루프에 노출할 spawn_agents 도구 정의. */
export function buildSpawnAgentsTool(): ToolDefinition {
    return {
        type: 'function',
        function: {
            name: SPAWN_AGENTS_TOOL_NAME,
            description: SPAWN_AGENTS_TOOL_DESCRIPTION,
            // ToolDefinition 의 properties 타입이 중첩 스키마(items)를 표현하지 못해 캐스트
            // (MCP 도구의 getLLMTools 캐스트와 동일 관행 — 런타임은 JSON 그대로 전달).
            parameters: SPAWN_AGENTS_PARAMETERS_SCHEMA as unknown as ToolDefinition['function']['parameters'],
        },
    };
}

/** PURE: 서브에이전트에 넘길 도구 서브셋 — 위임 계열(자기 자신 포함) 제외. */
export function buildSpawnSubagentTools(parentTools: ToolDefinition[]): ToolDefinition[] {
    return parentTools.filter((t) => !SUBAGENT_EXCLUDED_TOOLS.has(t.function.name));
}

/** PURE: 채팅 경로 서브 도구 키워드 필터 — 리서치 계열만 남겨 도구폭주를 차단.
 *  (라이브 관측: 혼합 19종 전달 시 qwen 서브가 무관 도구로 턴을 낭비해 스텁만 반환.)
 *  매칭 0개면 원본 폴백 — 필터가 서브를 무도구로 만들지 않게. */
export function filterChatSubTools(parentTools: ToolDefinition[]): ToolDefinition[] {
    const kept = parentTools.filter((t) => {
        const name = t.function.name.toLowerCase();
        return AGENT_SPAWN.SUB_TOOL_KEYWORDS.some((k) => name.includes(k));
    });
    return kept.length > 0 ? kept : parentTools;
}

export interface SpawnAgentsParams {
    /**
     * 서브 도구가 0개가 된 **이유**(있으면). 결과 머리에 그대로 실어 부모 모델·타임라인이
     * "조사한 결과"로 오인하지 않게 한다 — 도구 없는 서브는 기억으로 답을 지어낸다
     * (2026-08-26 라이브: 승인 정책 all 로 도구 전부 제외 → 기준금리를 "미확정"으로 날조).
     */
    noToolsReason?: string;
    /** 도구 호출 인자(raw) — 내부에서 Zod 검증. */
    args: Record<string, unknown>;
    client: LLMClient;
    /** 서브에이전트 도구 서브셋 — 호출부가 선별을 마친 목록(여기서 위임 계열만 재차 제외). */
    tools: ToolDefinition[];
    userCtx: UserContext;
    /** 승인 레지스트리 키(에이전트 작업 taskId). 채팅 경로는 정책 'none' 이라 식별용일 뿐. */
    taskId: string;
    sandboxCfg: Pick<TaskSandboxConfig, 'approvalPolicy' | 'approvalTimeoutMs'>;
    signal?: AbortSignal;
    onTokens?: (n: number) => void;
    onPausedMs?: (ms: number) => void;
}

/** role 지정 시 산업 전문가 페르소나, 미지정 시 범용 프롬프트. 실패는 범용으로 폴백. */
async function resolvePersona(task: SpawnTask, userId: string): Promise<string> {
    if (!task.role) return SPAWN_AGENT_GENERIC_PROMPT;
    try {
        const selection = await routeToAgent(`[${task.role}] ${task.prompt}`);
        const { prompt } = await getAgentSystemMessage(selection, userId);
        return prompt;
    } catch (e) {
        logger.debug(`[AgentSpawn] 페르소나 해석 실패(role=${task.role}) — 범용 폴백`, e);
        return SPAWN_AGENT_GENERIC_PROMPT;
    }
}

/**
 * 태스크별 실행 구성 — agentId(Custom Agent) 지정 시 그 에이전트의 페르소나와
 * model(있으면, BYOK 해석)로 실행. 미지정/실패는 기존 role 페르소나 + 부모 client.
 * 모델 선택권은 사용자가 정의한 에이전트에만 있음 — LLM 에 자유 model 필드를 열지 않는다.
 */
async function resolveTaskExecution(
    task: SpawnTask,
    userId: string,
    parentClient: LLMClient,
): Promise<{ persona: string; client: LLMClient; modelNote?: string }> {
    if (task.agentId) {
        try {
            const { UserAgentRepository } = await import('../../data/repositories/user-agent-repository');
            const { getPool } = await import('../../data/models/unified-database');
            // 소유 OR 워크스페이스 공유 에이전트를 서브에이전트 페르소나로 사용 허용 (loadUserAgent 와 대칭)
            const agent = await new UserAgentRepository(getPool()).getByIdVisibleToUser(task.agentId, userId);
            if (agent) {
                let client = parentClient;
                let modelNote: string | undefined;
                if (agent.model) {
                    const { resolveAssignedModelClient } = await import('../model-role-resolver');
                    const resolved = await resolveAssignedModelClient(agent.model, userId);
                    client = resolved.client;
                    modelNote = resolved.degraded ? `${agent.model} (폴백: 로컬)` : agent.model;
                }
                return { persona: agent.system_prompt, client, modelNote };
            }
            logger.debug(`[AgentSpawn] agentId '${task.agentId}' 조회 실패/권한 없음 — role 페르소나 폴백`);
        } catch (e) {
            logger.warn(`[AgentSpawn] custom agent 해석 실패 — 폴백:`, e);
        }
    }
    return { persona: await resolvePersona(task, userId), client: parentClient };
}

/**
 * spawn_agents 실행 — tasks 를 MAX_PARALLEL 동시성으로 병렬 수행하고 태스크별 결과를
 * 도구 결과 텍스트로 조립해 반환. 실패는 문자열로 흡수(호출 루프를 죽이지 않음).
 */
export async function runSpawnAgents(p: SpawnAgentsParams): Promise<string> {
    const parsed = spawnAgentsArgsSchema.safeParse(normalizeSpawnArgs(p.args));
    if (!parsed.success) {
        // 받은 형태를 함께 남긴다 — 2026-08-02 실패는 인자 원문이 어디에도 남지 않아 원인 추적이
        // 불가능했다(커밋 6a019d18 의 사후 분석으로만 "단일 객체" 로 추정). 값은 싣지 않는다.
        return `Error: tasks 배열([{prompt, role?}, ...], 최소 1개)이 필요합니다. 받은 인자: ${describeArgsShape(p.args)}`;
    }
    const requested = parsed.data.tasks;
    const tasks = requested.slice(0, AGENT_SPAWN.MAX_TASKS_PER_CALL);
    const droppedCount = requested.length - tasks.length;
    const subTools = buildSpawnSubagentTools(p.tools);
    const userId = String(p.userCtx.userId);
    const started = Date.now();
    logger.info(`[AgentSpawn] fan-out 시작: tasks=${tasks.length} (요청 ${requested.length}), `
        + `parallel=${AGENT_SPAWN.MAX_PARALLEL}, subTools=${subTools.length}`);
    // 도구 없는 fan-out 은 "병렬 조사"가 아니라 "병렬 기억 인출"이다 — 조용히 성공처럼 보이면 안 된다.
    const noToolsNotice = subTools.length === 0
        ? `⚠️ 서브에이전트가 도구 없이 답했습니다(${p.noToolsReason ?? '전달된 도구 없음'}) — `
            + '아래 내용은 검색·조회 없이 모델 기억만으로 작성된 것이라 사실 확인이 필요합니다.\n\n'
        : '';
    if (subTools.length === 0) logger.warn(`[AgentSpawn] 서브 도구 0개 — ${p.noToolsReason ?? '전달된 도구 없음'}`);

    // 활동 기록(109) — 에이전트 작업 경로만(채팅은 작업 행이 없다). fan-out 1회 = trace 1개.
    const traceId = p.taskId !== CHAT_PSEUDO_TASK_ID ? newTraceId() : null;
    let results: Array<string | null>;
    try {
        results = await parallelBatch(
            tasks,
            async (task, idx) => {
                try {
                    const exec = await resolveTaskExecution(task, userId, p.client);
                    if (exec.modelNote) {
                        logger.info(`[AgentSpawn] 태스크 ${idx + 1} custom agent 모델: ${exec.modelNote}`);
                    }
                    const trace = traceId
                        ? new SubagentTrace(p.taskId, traceId, 'spawn_agents', idx, task.role ?? task.agentId ?? null)
                        : undefined;
                    return await runSubagent({
                        ...(trace ? { trace } : {}),
                        client: exec.client,
                        personaPrompt: exec.persona,
                        subgoal: task.prompt,
                        tools: subTools,
                        userCtx: p.userCtx,
                        taskId: p.taskId,
                        sandboxCfg: p.sandboxCfg,
                        ...(p.signal ? { signal: p.signal } : {}),
                        ...(p.onTokens ? { onTokens: p.onTokens } : {}),
                        ...(p.onPausedMs ? { onPausedMs: p.onPausedMs } : {}),
                    });
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    logger.warn(`[AgentSpawn] 태스크 ${idx + 1} 실패: ${msg}`);
                    return `Error: 서브에이전트 실패 — ${msg}`;
                }
            },
            { concurrency: AGENT_SPAWN.MAX_PARALLEL, ...(p.signal ? { signal: p.signal } : {}) },
        );
    } catch {
        // parallelBatch 는 abort 시에만 throw(개별 실패는 null 흡수).
        return 'Error: 병렬 서브에이전트 실행이 중단되었습니다.';
    }

    logger.info(`[AgentSpawn] fan-out 완료 (${Date.now() - started}ms, tasks=${tasks.length}, `
        + `결과길이=[${results.map((r) => r?.length ?? 0).join(',')}])`);
    // 서브 결과 품질 관측용 프리뷰(스텁/메타서술 감지) — Phase 2 관측성 배선 전 임시 가시성.
    results.forEach((r, i) => logger.info(
        `[AgentSpawn] 태스크 ${i + 1} 결과 프리뷰: ${(r ?? '(null)').slice(0, 160).replace(/\n/g, ' ')}`));
    const sections = tasks.map((task, i) => {
        const header = `### 태스크 ${i + 1}/${tasks.length}${task.role ? ` (role: ${task.role})` : ''}: ${task.prompt.slice(0, 80)}`;
        return `${header}\n${results[i] ?? 'Error: 서브에이전트가 결과를 반환하지 못했습니다.'}`;
    });
    const truncationNote = droppedCount > 0
        ? `\n\n(주의: 태스크 상한 ${AGENT_SPAWN.MAX_TASKS_PER_CALL}개 초과분 ${droppedCount}개는 수행되지 않았습니다.)`
        : '';
    // 종합 강제 넛지 — 라이브 관측: qwen 이 spawn 결과를 받고도 같은 주제를 재검색하며
    // 턴 예산을 소진해 최종 종합 턴이 사라짐. 도구 결과 말미의 결정적 지시로 차단.
    const synthesisNudge = '\n\n지시: 위 서브에이전트 결과만으로 지금 바로 최종 답변을 종합해 작성하세요. '
        + '같은 주제를 다시 검색하거나 추가 도구를 호출하지 마세요.';
    return `[병렬 서브에이전트 결과 — ${tasks.length}개 태스크]\n\n${noToolsNotice}${sections.join('\n\n')}${truncationNote}${synthesisNudge}`;
}

/**
 * 채팅 경로 편의 래퍼 — runChatDelegate 와 대칭. 서브 LLM 은 'spawn' role 해석
 * (사용자 매핑 → 전역 env → 로컬 default, 외부는 BYOK 키 필요 — fail-open 폴백),
 * 승인 정책 'none' 고정(채팅 도구는 원래 승인 없이 실행되는 모델과 정합).
 */
export async function runChatSpawnAgents(params: {
    args: Record<string, unknown>;
    /** 부모 채팅의 활성 도구(자기 자신 포함 가능 — 내부에서 제외). */
    chatTools: ToolDefinition[];
    userCtx: UserContext;
    signal?: AbortSignal;
}): Promise<string> {
    const resolved = await resolveRoleClientForUser('spawn', String(params.userCtx.userId));
    if (resolved.degraded) {
        logger.warn(`[AgentSpawn] spawn role 폴백: ${resolved.degraded}`);
    }
    return runSpawnAgents({
        args: params.args,
        client: resolved.client,
        tools: filterChatSubTools(params.chatTools),
        userCtx: params.userCtx,
        taskId: CHAT_PSEUDO_TASK_ID, // 정책 'none' 이라 승인 레지스트리 미사용 — 식별용 문자열일 뿐
        sandboxCfg: { approvalPolicy: 'none', approvalTimeoutMs: 0 },
        ...(params.signal ? { signal: params.signal } : {}),
        onTokens: (n) => logger.debug(`[AgentSpawn] 채팅 서브 토큰 +${n}`),
    });
}

/** 에이전트 작업 경로 spawn 핸들러 — 도구 인자를 받아 결과 텍스트 반환(TaskRuntime 주입용). */
export type SpawnFn = (args: Record<string, unknown>) => Promise<string>;

/**
 * 에이전트 작업 경로 factory — buildDelegateFn 과 대칭. 서브 도구는 부모 호스트
 * 화이트리스트(extraTools)에서 선별하되, 승인 필요 도구는 배제해 병렬 HITL fan-in 을
 * 구조적으로 회피한다(Phase 1 — 배제된 도구는 승인 게이트에 도달할 수 없음).
 */
export function buildTaskSpawnFn(p: DelegateFactoryParams): SpawnFn {
    return async (args: Record<string, unknown>): Promise<string> => {
        const whitelisted = p.sandboxCfg.extraTools
            .map((n) => p.mcpTools.find((t) => t.function.name === n))
            .filter((t): t is ToolDefinition => !!t);
        // 자동 승인 작업이면 HITL fan-in 이 없으므로 배제할 이유가 없다 — 호출 시점에 판정한다
        // (자동 승인은 실행 중에도 켜진다). 운영 정책 all 에서 이 판정이 없으면 도구가 전부
        // 걷혀 서브가 기억으로만 답한다(2026-08-26 라이브 실측).
        const autoApproved = getApprovalRegistry().isAutoApprove(p.taskId);
        const subTools = autoApproved
            ? whitelisted
            : whitelisted.filter((t) => !requiresApproval(p.sandboxCfg.approvalPolicy, t.function.name, {}));
        const stripped = whitelisted.length - subTools.length;
        const noToolsReason = subTools.length === 0
            ? (whitelisted.length === 0
                ? '작업 호스트 도구 화이트리스트(TASK_SANDBOX_EXTRA_TOOLS)가 비어 있음'
                : `승인 정책 '${p.sandboxCfg.approvalPolicy}' 로 도구 ${stripped}개 제외 — 작업의 자동 승인을 켜면 서브에이전트도 검색할 수 있습니다`)
            : undefined;
        return runSpawnAgents({
            args,
            ...(noToolsReason ? { noToolsReason } : {}),
            client: p.client,
            tools: subTools,
            userCtx: p.userCtx,
            taskId: p.taskId,
            sandboxCfg: p.sandboxCfg,
            signal: p.signal,
            onTokens: p.onTokens,
            onPausedMs: p.onPausedMs,
        });
    };
}
