/**
 * ============================================================
 * AgentTaskService — 백그라운드 자율 도구 에이전트
 * ============================================================
 *
 * `external-provider.ts` 의 멀티턴 tool-calling 루프를 fork 하여 다음 seam 을 추가한다
 * (원본 hot-path 는 건드리지 않음 — "6 strategies 변경 금지" 관행):
 *   (1) 턴별 DB 체크포인트 (addAgentTaskStep) — 연결이 끊겨도 taskId 로 복구
 *   (2) task 전용 AbortController — WebSocket close 와 격리 (ws.close 가 죽이지 못함)
 *   (3) runaway 가드 (턴 상한 · 전체 타임아웃 · 누적 토큰 상한)
 *
 * DeepResearchService 처럼 REST 라우트에서 detached(`.catch()`)로 실행되며,
 * 진행상황/결과는 DB(agent_tasks / agent_task_steps)가 진실의 원천(DB-primary).
 *
 * @module services/AgentTaskService
 */
import { createClient, type LLMClient } from '../llm';
import type { ChatMessage, ToolDefinition } from '../llm/types';
import { getModelForRole } from '../config/model-roles';
import { getUnifiedMCPClient } from '../mcp/unified-client';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { AGENT_TASK_LIMITS, MAX_TOOL_RESULT_CHARS } from '../config/runtime-limits';
import { emitAgentTaskProgress } from '../utils/event-bus';
import { getAgentTaskSystemPrompt, getAgentTaskDeliverableNudge, getAgentTaskStuckNudge, getAgentTaskBrowserLimitNudge, getTaskSandboxGuidance } from '../prompts/agent-task-prompt';
import { extractAndStripArtifacts, type ExtractedArtifact } from '../llm/artifact-parser';
import { getPushService } from './PushService';
import { createLogger } from '../utils/logger';
import type { UserContext } from '../mcp/user-sandbox';
import { getSkillManager } from '../agents/skill-manager';
import { routeToAgent } from '../agents/keyword-router';
import { getAgentSystemMessage } from '../agents/system-prompt';
import { mergeToolsWithSkills, type ActiveSkillBinding } from './chat-service/tool-merger';
import { getTaskSandboxConfig } from '../config/task-sandbox';
import { TaskRuntime } from './task-sandbox/runtime';
import { TASK_TERMINATE_SENTINEL } from './task-sandbox/tools';
import { requiresApproval, getApprovalRegistry } from './task-sandbox/approval-gate';

const logger = createLogger('AgentTaskService');

/**
 * Agent Task 는 페르소나/산업 agent 를 우회하므로 고유 agentId 가 없다.
 * 스킬 스코프 조회 시 어떤 실제 agent_id(산업 agent id · uuid · __global__ · user:*)
 * 와도 겹치지 않는 sentinel 을 넘겨, __global__ + user:{userId} 스킬만 매칭시킨다.
 */
const AGENT_TASK_SKILL_AGENT_ID = '__agent_task__';

type UserRole = 'admin' | 'user' | 'guest';

/** tool name 이 검색/정보수집류인지 (키워드 포함 여부) — 검색 폭주 하드 제한용 */
function isSearchTool(name: string): boolean {
    const n = name.toLowerCase();
    return AGENT_TASK_LIMITS.SEARCH_TOOL_KEYWORDS.some((k) => n.includes(k));
}

/** 루프 종료 사유를 명확히 구분하기 위한 내부 에러 */
export class AgentTaskAbort extends Error {
    constructor(public readonly kind: 'aborted' | 'timeout' | 'token_limit') {
        super(kind);
        this.name = 'AgentTaskAbort';
    }
}

export interface AgentTaskRunInput {
    taskId: string;
    goal: string;
    userId: string;
    userRole: UserRole;
    maxTurns: number;
    /** 이 실행에서 사용할 스킬 범위(skill_id 목록). 지정 시 활성 스킬 바인딩을 이 집합으로 제한.
     *  미지정/빈 배열이면 사용자 전체 활성 스킬 사용(기존 동작). */
    allowedSkills?: string[];
    /** resume(이어하기): 기존 end-of-turn checkpoint 에서 복원 */
    resume?: {
        conversation: ChatMessage[];
        fromTurn: number;
        fromStep: number;
    };
}

export class AgentTaskService {
    /** 실행 중 인스턴스 레지스트리 — detached 실행을 cancel 엔드포인트에서 중단하기 위함 */
    private static readonly running = new Map<string, AgentTaskService>();

    private readonly client: LLMClient;
    private readonly abortController = new AbortController();

    constructor(model?: string) {
        this.client = createClient({ model: model || getModelForRole('chat') });
    }

    /**
     * taskId 로 실행 중인 작업을 취소. 실행 중이면 AbortController 를 신호하고 true 반환,
     * 레지스트리에 없으면(이미 종료/타 프로세스) false 반환 — 호출자가 DB 상태를 직접 갱신.
     */
    static cancel(taskId: string): boolean {
        const svc = AgentTaskService.running.get(taskId);
        if (!svc) return false;
        svc.abort();
        return true;
    }

    /** 외부에서 작업 취소 */
    abort(): void {
        this.abortController.abort();
    }

    /**
     * 자율 도구 루프 실행. 백그라운드 detached 호출 전제 — 예외를 던지지 않고
     * 모든 종료 경로에서 agent_tasks 상태를 갱신한다.
     */
    async execute(input: AgentTaskRunInput): Promise<void> {
        const { taskId, goal, userId, userRole, maxTurns, allowedSkills } = input;
        const db = getUnifiedDatabase();
        const mcp = getUnifiedMCPClient();
        const signal = this.abortController.signal;
        const startedAt = Date.now();
        const turnCeiling = Math.min(maxTurns, AGENT_TASK_LIMITS.MAX_TURNS_CEILING);

        const userCtx: UserContext = { userId, role: userRole };

        let stepNumber = input.resume?.fromStep ?? 0;
        let totalTokens = 0;
        let searchCalls = 0;
        let searchLimitNotified = false;
        let browserCalls = 0;
        let browserLimitNotified = false;
        let curStatus = 'pending';
        let curProgress = 0;
        let curTurn = 0;
        let taskRuntime: TaskRuntime | null = null;
        const recentSignatures: string[] = [];
        let stuckNotified = false;

        // DB 갱신 + 진행상황 발행(fire-and-forget). ws 계층이 구독해 owner user 에게 relay.
        // ws 를 직접 참조하지 않으므로 소켓 연결 여부와 무관하게 실행은 끝까지 진행된다.
        const update = async (u: Parameters<typeof db.updateAgentTask>[1]): Promise<void> => {
            curStatus = (u.status ?? curStatus) as string;
            curProgress = u.progress ?? curProgress;
            curTurn = u.currentTurn ?? curTurn;
            await db.updateAgentTask(taskId, u);
            emitAgentTaskProgress({ userId, taskId, status: curStatus, progress: curProgress, currentTurn: curTurn });
            // terminal 상태 → web push (페이지가 닫혀 있어도 알림). fire-and-forget, VAPID 미설정 시 no-op.
            if (u.status === 'completed' || u.status === 'failed' || u.status === 'cancelled') {
                const label = u.status === 'completed' ? '완료' : u.status === 'failed' ? '실패' : '취소';
                const shortGoal = goal.length > 60 ? goal.slice(0, 60) + '…' : goal;
                void getPushService().sendPush(userId, {
                    title: 'OpenMake 에이전트 작업',
                    body: `작업이 ${label}되었습니다: ${shortGoal}`,
                    url: '/agent-tasks',
                }).catch(() => { /* noop */ });
            }
        };

        // cancel 레이스 봉쇄: 어떤 await 보다 먼저 레지스트리에 등록해 /cancel 이 항상
        // AbortController 에 도달하게 한다 (기존엔 스킬 조회 await 사이의 취소가 유실됐다).
        AgentTaskService.running.set(taskId, this);
        try {
            // 레지스트리 등록 전(detached 스케줄링 창)에 접수된 취소는 DB 에만 기록됨 — 시작 전 존중.
            const preStatus = (await db.getAgentTask(taskId))?.status;
            if (signal.aborted || preStatus === 'cancelled') throw new AgentTaskAbort('aborted');

            // resume: 기존 checkpoint(완전한 end-of-turn conversation)에서 복원, 아니면 새로 시작.
            // 새 시작 시 system 프롬프트에 활성 스킬(global+user)의 지식(prompt_md)을 주입한다.
            // resume 의 system 은 old checkpoint 그대로이므로, 작업 중 스킬이 바뀌면 지식(system)과
            // 도구 바인딩(매 실행 fresh)이 갈릴 수 있다 — 무해, 재개 일관성을 위한 의도된 동작.
            const conversation: ChatMessage[] = input.resume
                ? [...input.resume.conversation]
                : [
                    { role: 'system', content: getAgentTaskSystemPrompt() + (await this.buildSkillPromptBlock(userId)) },
                    { role: 'user', content: goal },
                ];
            const startTurn = input.resume?.fromTurn ?? 0;

            await update({ status: 'running', progress: 2 });
            // fresh 재실행(실패/취소 작업을 처음부터): 이전 시도의 스텝을 비워
            // stepNumber 0 재시작으로 인한 (task_id, step_number) 중복·표시 혼선을 방지.
            if (!input.resume) await db.deleteAgentTaskSteps(taskId);

            // 허용 도구 목록 (LLMTool ≈ ToolDefinition) — 전체 노출
            const allTools = (await mcp.getToolRouter().getLLMTools({
                userId,
            })) as unknown as ToolDefinition[];

            // 활성 스킬(global+user)의 tool_bindings 를 머지.
            // base 가 전체 도구라 실효는 사실상 denied(특정 도구 차단)뿐이다.
            // 조회 실패는 작업을 실패시키지 않고 빈 바인딩으로 흡수.
            let skillBindings: ActiveSkillBinding[] = [];
            try {
                skillBindings = await getSkillManager().getActiveSkillBindings(AGENT_TASK_SKILL_AGENT_ID, userId);
            } catch (e) {
                logger.debug('[AgentTask] 스킬 도구 바인딩 조회 실패 — 빈 배열', e);
            }
            // 스킬 범위 지정 시(allowedSkills): 활성 바인딩을 해당 skill_id 집합으로 제한.
            // 미지정/빈 배열이면 전체 사용(기존 동작).
            if (allowedSkills && allowedSkills.length > 0) {
                const allow = new Set(allowedSkills);
                const before = skillBindings.length;
                skillBindings = skillBindings.filter((b) => allow.has(b.skill_id));
                logger.debug(`[AgentTask] 스킬 범위 제한: ${before} → ${skillBindings.length} (allowedSkills=${allowedSkills.length})`);
            }
            const mcpTools = skillBindings.length > 0
                ? mergeToolsWithSkills({ allTools, userToggled: allTools, profileRequired: [], skillBindings })
                : allTools;

            // 영속 샌드박스(Manus화) — 플래그 ON 일 때만. OFF 면 runtime=null 로 기존 동작 그대로.
            // 생성 실패는 작업을 죽이지 않고 샌드박스 없이 진행(graceful degrade).
            // 설정은 한 번만 읽어 enabled 게이트·런타임·extraTools·승인 정책이 동일 스냅샷을 공유.
            const sandboxCfg = getTaskSandboxConfig();
            if (sandboxCfg.enabled) {
                try {
                    // G4 위임: subgoal 을 적합 산업 전문가 페르소나로 1회 자문(재귀 루프 없음).
                    const delegateFn = async (subgoal: string, role?: string): Promise<string> => {
                        const selection = await routeToAgent(role ? `[${role}] ${subgoal}` : subgoal);
                        const { prompt } = await getAgentSystemMessage(selection, userId);
                        const r = await this.client.chat(
                            [{ role: 'system', content: prompt }, { role: 'user', content: subgoal }],
                            undefined, undefined, { think: false, signal },
                        );
                        return r.content ?? '';
                    };
                    taskRuntime = new TaskRuntime(taskId, userId, sandboxCfg, delegateFn);
                    await taskRuntime.create();
                    await db.updateAgentTask(taskId, {
                        sandboxContainerId: taskRuntime.containerName,
                        workspacePath: taskRuntime.workspacePath,
                    });
                    // 새 대화면 system 에 작업환경(셸+FS)+플랜 도구 안내 주입(workspace-aware).
                    // resume 는 기존 checkpoint system 유지(일관성).
                    if (!input.resume && conversation[0]?.role === 'system') {
                        conversation[0].content += getTaskSandboxGuidance();
                    }
                    logger.info(`[AgentTask] 샌드박스 활성 (${taskId}, ${taskRuntime.containerName})`);
                } catch (e) {
                    logger.warn(`[AgentTask] 샌드박스 생성 실패 — 미사용 진행: ${e instanceof Error ? e.message : e}`);
                    taskRuntime = null;
                }
            }
            // 샌드박스(Manus) 활성 시: LLM 에 샌드박스 도구만 노출(셸/파이썬/브라우저/파일/플랜).
            // 전체 MCP 카탈로그(~150 도구)를 함께 넘기면 도구 스키마 union 이 수백 KB 로 부풀어
            // vLLM guided-decoding 문법 컴파일이 100s+ 로 폭주 → LLM_TIMEOUT 초과(Connection error).
            // Manus 모델에선 에이전트가 컨테이너 셸/브라우저로 작업하므로 외부 MCP 카탈로그가 불필요.
            // 단, 샌드박스로 대체 불가한 소수 고가치 내장 도구(extraTools 화이트리스트, 예: generate_image,
            // web_search)는 mcpTools 에서 이름으로 선별해 합류 — 도구 수가 적어 문법 컴파일 폭주가 없다.
            // extraTools 로 노출된 비-task 도구 이름 집합 — 디스패치에서 호스트 실행 전 승인 게이트 적용에 사용.
            const extraToolNames = new Set<string>();
            const buildExtra = (sandboxToolNames: Set<string>): typeof mcpTools => {
                const extra: typeof mcpTools = [];
                for (const name of sandboxCfg.extraTools) {
                    // 샌드박스 도구와 이름 충돌 시 제외(중복 function.name 으로 인한 요청 거부·섀도잉 방지).
                    if (sandboxToolNames.has(name)) {
                        logger.warn(`[AgentTask] extraTools '${name}' 가 샌드박스 도구와 이름 충돌 — 무시`);
                        continue;
                    }
                    const tool = mcpTools.find((t) => t.function.name === name);
                    if (!tool) {
                        // 오타·스킬 거부 등으로 카탈로그에 없으면 조용히 누락되지 않게 경고.
                        logger.warn(`[AgentTask] extraTools '${name}' 를 도구 카탈로그에서 찾지 못함 — 노출 생략`);
                        continue;
                    }
                    extra.push(tool);
                    extraToolNames.add(name);
                }
                return extra;
            };
            let tools: typeof mcpTools;
            if (taskRuntime) {
                const sandboxTools = taskRuntime.getLLMTools();
                tools = [...buildExtra(new Set(sandboxTools.map((t) => t.function.name))), ...sandboxTools];
            } else if (sandboxCfg.enabled) {
                // 샌드박스 ENABLED 인데 생성 실패(degrade): 전체 카탈로그(~150)는 hang 을 유발하므로
                // 화이트리스트 도구만으로 진행 — 셸 작업은 불가하나 검색·이미지·작성 작업은 계속 가능.
                tools = buildExtra(new Set<string>());
                logger.warn(`[AgentTask] 샌드박스 미가용 — extraTools(${extraToolNames.size}개)만으로 진행 (전체 카탈로그 미전달)`);
            } else {
                // 샌드박스 OFF(legacy) 경로 — 기존대로 전체 MCP 도구 사용.
                tools = mcpTools;
            }

            for (let turn = startTurn; turn < turnCeiling; turn++) {
                this.assertWithinLimits(signal, startedAt, totalTokens);

                await update({
                    currentTurn: turn + 1,
                    progress: Math.min(95, 5 + Math.round((turn / turnCeiling) * 90)),
                });

                // 검색류/브라우저 도구 호출이 한도를 넘으면 해당 도구를 제거해 강제로 종합/작성 단계로 유도.
                // 프롬프트 지시를 LLM 이 무시하더라도 도구 자체가 사라지므로 탐색 폭주가 끊긴다.
                // browser 는 SEARCH_TOOL_KEYWORDS 에 안 잡혀 검색 throttle 로 제어 불가하므로 별도 cap.
                const overSearchLimit = searchCalls >= AGENT_TASK_LIMITS.MAX_SEARCH_CALLS;
                const overBrowserLimit = browserCalls >= AGENT_TASK_LIMITS.MAX_BROWSER_CALLS;
                const effectiveTools = (overSearchLimit || overBrowserLimit)
                    ? tools.filter((t) => {
                        const n = t.function.name;
                        if (overSearchLimit && isSearchTool(n)) return false;
                        if (overBrowserLimit && n === 'browser') return false;
                        return true;
                    })
                    : tools;
                if (overSearchLimit && !searchLimitNotified) {
                    conversation.push({
                        role: 'user',
                        content: '검색 횟수 한도에 도달했습니다. 더 이상 검색하지 말고, 지금까지 수집한 정보만으로 최종 결과물(예: 블로그 초안)을 완성해 작성하세요.',
                    });
                    searchLimitNotified = true;
                }
                if (overBrowserLimit && !browserLimitNotified) {
                    conversation.push({ role: 'user', content: getAgentTaskBrowserLimitNudge() });
                    browserLimitNotified = true;
                }

                // per-call abort: 작업 잔여 예산을 호출에도 바인딩 — 응답이 hang 되면
                // 턴 사이 assertWithinLimits 까지 도달하지 못하므로 호출 자체를 끊는다.
                const remainingMs = Math.max(
                    1_000,
                    AGENT_TASK_LIMITS.TOTAL_TIMEOUT_MS - (Date.now() - startedAt)
                );
                const callSignal = AbortSignal.any([signal, AbortSignal.timeout(remainingMs)]);

                const result = await this.client.chat(conversation, undefined, undefined, {
                    tools: effectiveTools,
                    signal: callSignal,
                    // reasoning OFF — qwen3.6 가 디자인/장문 작업에서 수만 토큰의 thinking 을
                    // 생성해 토큰 한도를 소진하고 deliverable 을 못 쓰는 폭주 차단.
                    // 도구 루프의 단계별 reasoning 은 대화 구조 자체가 대신한다.
                    think: false,
                });
                totalTokens +=
                    (result.metrics?.prompt_eval_count ?? 0) + (result.metrics?.eval_count ?? 0);
                // 토큰 상한을 호출 직후 즉시 검사 — 큰 도구 결과로 컨텍스트가 부풀어
                // 한도를 넘겼을 때 다음 턴까지 기다리지 않고 바로 중단(runaway 방어 강화).
                if (totalTokens > AGENT_TASK_LIMITS.MAX_TOTAL_TOKENS) {
                    throw new AgentTaskAbort('token_limit');
                }

                conversation.push({
                    role: 'assistant',
                    content: result.content,
                    ...(result.tool_calls && { tool_calls: result.tool_calls }),
                });

                // stuck 감지 — 동일 응답(내용+도구호출)이 STUCK_THRESHOLD 회 연속되면 전략변경 유도.
                // (OpenManus BaseAgent.is_stuck → handle_stuck_state 패턴. 무한루프/제자리맴돔 방지.)
                const sig = JSON.stringify({
                    c: result.content ?? '',
                    t: (result.tool_calls ?? []).map((x) => ({ n: x.function.name, a: x.function.arguments })),
                });
                recentSignatures.push(sig);
                if (recentSignatures.length > AGENT_TASK_LIMITS.STUCK_THRESHOLD) recentSignatures.shift();
                const stuck = recentSignatures.length >= AGENT_TASK_LIMITS.STUCK_THRESHOLD
                    && recentSignatures.every((s) => s === sig);
                if (stuck && !stuckNotified) {
                    conversation.push({ role: 'user', content: getAgentTaskStuckNudge() });
                    stuckNotified = true;
                    logger.info(`[AgentTask] stuck 감지 → 전략변경 주입: ${taskId} (turn ${turn + 1})`);
                } else if (!stuck) {
                    stuckNotified = false;
                }

                const hasToolCalls = !!result.tool_calls && result.tool_calls.length > 0;

                // 최종 답변 턴이면 deliverable(<artifact> 태그) 추출 — 스텝/result 는
                // cleaned 본문으로 기록하고, 아티팩트는 step_type='artifact' 행으로 영속화.
                const extracted = hasToolCalls ? null : extractAndStripArtifacts(result.content ?? '');
                const stepContent = extracted ? extracted.cleanedContent : result.content;

                // 스텝 기록(display용). 첫 턴은 목표 분해 계획(plan)으로 표시.
                // resume 복원 상태(turn>0)는 plan 이 아님 — 중간 재개이므로 자동 제외됨.
                const stepType = turn === 0
                    ? 'plan'
                    : (hasToolCalls ? 'assistant_tool_call' : 'assistant');
                await db.addAgentTaskStep({
                    taskId,
                    stepNumber: stepNumber++,
                    stepType,
                    content: stepContent,
                });

                if (!hasToolCalls) {
                    // 턴 0 계획-만 가드: 도구가 필요 없는 목표에서 모델이 계획만 쓰고 멈추면
                    // 결과물 없이 종료된다 — deliverable(artifact) 이 없으면 1회 재촉 후 계속.
                    if (turn === startTurn && extracted!.artifacts.length === 0) {
                        conversation.push({ role: 'user', content: getAgentTaskDeliverableNudge() });
                        continue;
                    }
                    stepNumber = await this.persistArtifactSteps(taskId, extracted!.artifacts, stepNumber);
                    await update({
                        status: 'completed',
                        progress: 100,
                        result: stepContent,
                        checkpoint: null, // 완료 작업은 재개 대상 아님 — checkpoint 잔존 시 resume 허용·저장 팽창
                    });
                    logger.info(`[AgentTask] 완료: ${taskId} (${turn + 1} 턴, ${totalTokens} 토큰, 아티팩트 ${extracted!.artifacts.length}개)`);
                    return;
                }

                // 도구 실행 + 체크포인트
                let terminated = false;
                let terminateSummary = '';
                // 승인 대기 진입 콜백 — task 도구·extra 도구 공용(status='paused' + web-push).
                const onApprovalPending = (toolName: string) => {
                    void update({ status: 'paused' }).catch(() => { /* noop */ });
                    void getPushService().sendPush(userId, {
                        title: 'OpenMake 에이전트 — 승인 필요',
                        body: `도구 실행 승인을 기다립니다: ${toolName}`,
                        url: '/agent-tasks',
                    }).catch(() => { /* noop */ });
                };
                for (const tc of result.tool_calls!) {
                    if (signal.aborted) throw new AgentTaskAbort('aborted');
                    const name = tc.function.name;
                    if (isSearchTool(name)) searchCalls++;
                    if (name === 'browser') browserCalls++;
                    const args = (tc.function.arguments ?? {}) as Record<string, unknown>;
                    let toolResult: string;
                    if (taskRuntime?.isTaskTool(name)) {
                        // task 도구 — 승인 게이트 통과 후 영속 샌드박스에서 실행.
                        toolResult = await taskRuntime.executeTaskTool(name, args, {
                            signal,
                            onApprovalPending: (p) => onApprovalPending(p.toolName),
                        });
                        if (curStatus === 'paused') await update({ status: 'running' }).catch(() => { /* noop */ });
                        if (toolResult.includes(TASK_TERMINATE_SENTINEL)) {
                            terminated = true;
                            terminateSummary = String(args.summary ?? '');
                        }
                    } else if (extraToolNames.has(name)) {
                        // extra(화이트리스트) 도구 — 샌드박스 밖 호스트에서 실행되지만 HITL 승인은 task 도구와 동일 적용.
                        // (이 도구들은 격리 컨테이너가 아니라 API 프로세스에서 실행되므로 승인 우회를 닫는다.)
                        // extraToolNames 는 샌드박스 ENABLED(활성·degrade) 일 때만 채워지므로 legacy OFF 경로엔 영향 없음.
                        const decision = requiresApproval(sandboxCfg.approvalPolicy, name, args)
                            ? await getApprovalRegistry().request(
                                { taskId, userId, toolName: name, args },
                                { timeoutMs: sandboxCfg.approvalTimeoutMs, signal, onPending: (p) => onApprovalPending(p.toolName) },
                            )
                            : 'approved';
                        if (curStatus === 'paused') await update({ status: 'running' }).catch(() => { /* noop */ });
                        toolResult = decision === 'approved'
                            ? await this.runTool(mcp, name, args, userCtx)
                            : `Error: 사용자가 도구 실행을 승인하지 않았습니다 (${name}). 다른 방법을 시도하거나 작업을 종료하세요.`;
                    } else {
                        toolResult = await this.runTool(mcp, name, args, userCtx);
                    }
                    conversation.push({
                        role: 'tool',
                        content: toolResult,
                        tool_name: name,
                        tool_call_id: tc.id,
                    });
                    await db.addAgentTaskStep({
                        taskId,
                        stepNumber: stepNumber++,
                        stepType: 'tool_result',
                        toolName: name,
                        content: toolResult,
                    });
                }

                // terminate 도구 호출 — 깔끔한 완료 시그널(max_turns 소진 아님).
                if (terminated) {
                    const ex = extractAndStripArtifacts(result.content ?? '');
                    stepNumber = await this.persistArtifactSteps(taskId, ex.artifacts, stepNumber);
                    await update({
                        status: 'completed',
                        progress: 100,
                        result: terminateSummary || ex.cleanedContent || '작업을 완료했습니다.',
                        checkpoint: null,
                    });
                    logger.info(`[AgentTask] terminate 완료: ${taskId} (${turn + 1} 턴)`);
                    return;
                }

                // end-of-turn 체크포인트: tool 결과까지 포함된 완전한 conversation + 완료 턴 번호.
                // 이 시점의 conversation 은 tool_call_id 가 매칭된 valid 상태라 그대로 resume 가능.
                // (현재 모든 도구가 idempotent-read 라 턴 재실행 안전 — write 도구 추가 시 gate 필요)
                const planSnapshot = taskRuntime?.getPlanSnapshot();
                await db.updateAgentTask(taskId, {
                    checkpoint: { conversation, completedTurn: turn },
                    ...(planSnapshot && planSnapshot.length > 0 ? { plan: planSnapshot } : {}),
                });
            }

            // 턴 상한 도달 — 마지막 assistant 내용을 결과로 보존 (deliverable 태그가 있으면 추출)
            const lastAssistant = [...conversation].reverse().find((m) => m.role === 'assistant');
            const lastRaw = (lastAssistant?.content as string) || '(최대 턴에 도달하여 종료되었습니다.)';
            const lastExtracted = extractAndStripArtifacts(lastRaw);
            stepNumber = await this.persistArtifactSteps(taskId, lastExtracted.artifacts, stepNumber);
            await update({
                status: 'completed',
                progress: 100,
                result: lastExtracted.cleanedContent || lastRaw,
                checkpoint: null,
            });
            logger.info(`[AgentTask] 턴 상한 종료: ${taskId} (${turnCeiling} 턴)`);
        } catch (err) {
            // signal.aborted 가 true 면 client.chat() 호출 도중 던져진 AbortError
            // ("Request was aborted") 도 사용자 취소로 분류 — 턴 사이 abort 뿐 아니라
            // LLM 호출 중간 취소도 cancelled 로 일관 처리.
            const aborted = signal.aborted || (err instanceof AgentTaskAbort && err.kind === 'aborted');
            const kind = aborted ? 'aborted' : (err instanceof AgentTaskAbort ? err.kind : 'failed');
            const msg = err instanceof Error ? err.message : String(err);
            await update({
                status: aborted ? 'cancelled' : 'failed',
                error: aborted ? kind : msg,
            }).catch((e) => logger.warn(`[AgentTask] 상태 갱신 실패: ${e}`));
            logger.warn(`[AgentTask] ${aborted ? '취소' : '실패'}: ${taskId} — ${kind}: ${msg}`);
        } finally {
            AgentTaskService.running.delete(taskId);
            if (taskRuntime) {
                // 완료 시 workspace 보존(산출물 다운로드용), 실패/취소 시 삭제. 컨테이너는 항상 제거.
                const keepWorkspace = curStatus === 'completed';
                await taskRuntime.cleanup(!keepWorkspace).catch((e) =>
                    logger.warn(`[AgentTask] 샌드박스 정리 실패: ${taskId} — ${e}`));
            }
        }
    }

    /**
     * 최종 답변에서 추출한 deliverable 아티팩트를 step_type='artifact' 행으로 영속화.
     * content 는 ExtractedArtifact JSON (id/kind/title/lang/content) — 프론트 상세 모달이 파싱해 렌더.
     * 저장 실패는 작업을 실패시키지 않는다 (result 본문은 이미 보존됨).
     */
    private async persistArtifactSteps(
        taskId: string,
        artifacts: ExtractedArtifact[],
        stepNumber: number
    ): Promise<number> {
        const db = getUnifiedDatabase();
        for (const artifact of artifacts) {
            try {
                await db.addAgentTaskStep({
                    taskId,
                    stepNumber: stepNumber++,
                    stepType: 'artifact',
                    toolName: artifact.kind,
                    content: JSON.stringify(artifact),
                });
            } catch (e) {
                logger.warn(`[AgentTask] 아티팩트 스텝 저장 실패: ${taskId} — ${e}`);
            }
        }
        return stepNumber;
    }

    /** runaway 가드 — 한도 초과 시 종류별 AgentTaskAbort throw */
    private assertWithinLimits(signal: AbortSignal, startedAt: number, totalTokens: number): void {
        if (signal.aborted) throw new AgentTaskAbort('aborted');
        if (Date.now() - startedAt > AGENT_TASK_LIMITS.TOTAL_TIMEOUT_MS) {
            throw new AgentTaskAbort('timeout');
        }
        if (totalTokens > AGENT_TASK_LIMITS.MAX_TOTAL_TOKENS) {
            throw new AgentTaskAbort('token_limit');
        }
    }

    /**
     * 활성 스킬(global + user)의 prompt_md 지식 블록을 만든다.
     * execute 의 status 머신(try)이 켜지기 전에 호출되므로 절대 throw 하지 않는다 —
     * 실패/부재 시 '' 를 반환해 task row 가 stuck 되지 않게 한다.
     */
    private async buildSkillPromptBlock(userId: string): Promise<string> {
        try {
            const block = await getSkillManager().buildManifestPrompt(AGENT_TASK_SKILL_AGENT_ID, userId);
            return block ?? '';
        } catch (e) {
            logger.debug('[AgentTask] 스킬 프롬프트 주입 실패 — 무시', e);
            return '';
        }
    }

    /** 단일 도구 실행 — sandbox 는 executeToolWithContext 가 처리. 실패는 문자열로 흡수 */
    private async runTool(
        mcp: ReturnType<typeof getUnifiedMCPClient>,
        name: string,
        args: Record<string, unknown>,
        userCtx: UserContext,
    ): Promise<string> {
        try {
            const r = await mcp.executeToolWithContext(name, args, userCtx);
            // 문자열/JSON 양쪽 모두 캡 적용 — 대형 결과가 통째로 대화에 들어가면
            // 컨텍스트·체크포인트가 부풀어 token_limit abort 로 작업이 실패한다.
            const raw = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
            const text = raw.length > MAX_TOOL_RESULT_CHARS
                ? raw.slice(0, MAX_TOOL_RESULT_CHARS) + '\n...[결과가 길어 잘렸습니다]'
                : raw;
            return r.isError ? `Error: ${text}` : text;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`[AgentTask] 도구 실행 실패 (${name}): ${msg}`);
            return `Error: ${msg}`;
        }
    }
}
