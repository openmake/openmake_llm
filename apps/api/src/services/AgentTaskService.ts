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
import { type LLMClient } from '../llm';
import type { ChatMessage, ToolDefinition } from '../llm/types';
import { initAgentRoleState, chatTurnWithRoleFallback, judgeClientFor, defaultAgentClient } from './agent-task/role-client';
import { getUnifiedMCPClient } from '../mcp/unified-client';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { AGENT_TASK_LIMITS, AGENT_SPAWN } from '../config/runtime-limits';
import { emitAgentTaskProgress } from '../utils/event-bus';
import { getAgentTaskSystemPrompt, getAgentTaskDeliverableNudge, getAgentTaskStuckNudge, getAgentTaskBrowserLimitNudge, getTaskSandboxGuidance, getAgentTaskUploadedFilesNote, getAgentTaskVerifyFailedNudge, AGENT_TASK_INCOMPLETE_MARKER } from '../prompts/agent-task-prompt';
import { extractAndStripArtifacts } from '../llm/artifact-parser';
import { getPushService } from './PushService';
import { createLogger } from '../utils/logger';
import type { UserContext } from '../mcp/user-sandbox';
import { getSkillManager } from '../agents/skill-manager';
import { buildDelegateFn } from './agent-task/delegate';
import { buildTaskSpawnFn } from './agent-spawn/spawn-agents';
import { mergeToolsWithSkills, type ActiveSkillBinding } from './chat-service/tool-merger';
import { getTaskSandboxConfig } from '../config/task-sandbox';
import { TaskRuntime } from './task-sandbox/runtime';
import { TASK_TERMINATE_SENTINEL } from './task-sandbox/tools';
import { requiresApproval, getApprovalRegistry } from './task-sandbox/approval-gate';
import { buildFileContext } from './chat-service/attach-context';
import { AgentTaskAbort, assertWithinLimits, type AgentTaskRunInput } from './agent-task/types';
import { writeInputFilesToWorkspace } from './agent-task/task-inputs';
import { judgeGoalAchieved, buildJudgeExecutionContext } from './agent-task/goal-judge';
import { persistArtifactSteps, runTool, isSearchTool } from './agent-task/task-steps';
import { initWorkspaceBaseline, maybePersistCodeDiff, captureDiffOnCleanup } from './agent-task/code-diff';
import { getSteeringRegistry, applyPendingSteering } from './agent-task/steering';
import { setupTaskRepo } from './agent-task/git-ops';
import { assembleAgentTools } from './agent-task/tool-assembly';
import { verifyCodeArtifacts } from './agent-task/deliverable-verify';
import { buildLearningBlock } from './agent-task/task-learning';
import { buildSkillPromptBlock, AGENT_TASK_SKILL_AGENT_ID } from './agent-task/skill-block';

// 기존 import 호환 재노출 — 타입/에러는 services/agent-task/types 로 분리 (파일 크기 가드).
export { AgentTaskAbort, type AgentTaskRunInput, type AgentTaskInputFile } from './agent-task/types';

const logger = createLogger('AgentTaskService');

export class AgentTaskService {
    /** 실행 중 인스턴스 레지스트리 — detached 실행을 cancel 엔드포인트에서 중단하기 위함 */
    private static readonly running = new Map<string, AgentTaskService>();

    private client: LLMClient;
    private readonly abortController = new AbortController();
    private readonly explicitModel: boolean; // model 명시 시 role 해석 생략 (기존 계약 유지)

    constructor(model?: string) {
        this.client = defaultAgentClient(model);
        this.explicitModel = !!model;
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

        // 'agent' role 해석 — 상세는 agent-task/role-client (생성자 model 명시 시 그대로 사용)
        const roleState = await initAgentRoleState(taskId, String(userId), this.explicitModel ? this.client : undefined);
        this.client = roleState.client;

        let stepNumber = input.resume?.fromStep ?? 0;
        let totalTokens = 0;
        // pause-aware 타임아웃(4-1): 승인 대기 시간 누적 — 총 타임아웃 예산에서 제외한다.
        // HITL 이 켜져 있을수록(승인 대기가 길수록) task 가 timeout 으로 죽던 역설 해소.
        // 개별 대기는 approvalTimeoutMs 가 별도 상한이므로 무한 연장은 불가.
        let pausedMs = 0;
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
        let verifyRetries = 0;
        // 5-3(b): 실제 사용한 도구 추적 — goal judge 의 실행 컨텍스트(수행 흔적)로 전달.
        const usedTools = new Set<string>();

        // DB 갱신 + 진행상황 발행(fire-and-forget). ws 계층이 구독해 owner user 에게 relay.
        // ws 를 직접 참조하지 않으므로 소켓 연결 여부와 무관하게 실행은 끝까지 진행된다.
        const update = async (u: Parameters<typeof db.updateAgentTask>[1]): Promise<void> => {
            curStatus = (u.status ?? curStatus) as string;
            curProgress = u.progress ?? curProgress;
            curTurn = u.currentTurn ?? curTurn;
            // terminal 전이 시 누적 토큰 영속(4-4) — 목록/상세 UI 의 비용 가시화에 사용.
            if (u.status === 'completed' || u.status === 'failed' || u.status === 'cancelled') {
                u = { ...u, totalTokens };
            }
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
            const preTask = await db.getAgentTask(taskId);
            if (signal.aborted || preTask?.status === 'cancelled') throw new AgentTaskAbort('aborted');
            // resume: 이전 실행분 토큰을 이어서 누적(4-4) — runaway 토큰 가드도 통산 기준으로 동작.
            if (input.resume) totalTokens = Number(preTask?.total_tokens ?? 0);

            // resume: 기존 checkpoint(완전한 end-of-turn conversation)에서 복원, 아니면 새로 시작.
            // 새 시작 시 system 프롬프트에 활성 스킬(global+user)의 지식(prompt_md)을 주입한다.
            // resume 의 system 은 old checkpoint 그대로이므로, 작업 중 스킬이 바뀌면 지식(system)과
            // 도구 바인딩(매 실행 fresh)이 갈릴 수 있다 — 무해, 재개 일관성을 위한 의도된 동작.
            // 크로스-task 학습(5-2): 과거 유사 작업 교훈 블록 — 플래그 OFF/실패 시 ''(미주입).
            const conversation: ChatMessage[] = input.resume
                ? [...input.resume.conversation]
                : [
                    {
                        role: 'system',
                        content: getAgentTaskSystemPrompt()
                            + (await buildSkillPromptBlock(userId))
                            + (await buildLearningBlock(userId, goal, taskId)),
                    },
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

            // 영속 샌드박스(Manus화, 플래그 ON 시만). 생성 실패는 샌드박스 없이 진행(graceful degrade).
            // 설정은 한 번만 읽어 스냅샷 공유. 승인 3모드는 input.approvalPolicy 로 이 실행에만 override
            // (비영속, resume은 전역 폴백; requiresApproval 호출부 2곳이 이 cfg 를 읽어 단일 지점 주입).
            const sandboxCfg = input.approvalPolicy
                ? { ...getTaskSandboxConfig(), approvalPolicy: input.approvalPolicy } : getTaskSandboxConfig();
            if (sandboxCfg.enabled) {
                try {
                    // G4 위임 — 상세는 agent-task/delegate (SUBAGENT_ENABLED 시 depth=1 tool-loop 승격,
                    // 토큰·승인대기는 부모 누적에 합산되어 runaway 가드·pause-aware 타임아웃 공유).
                    const delegateFn = buildDelegateFn({
                        client: this.client, userId, taskId, userCtx, sandboxCfg, mcpTools, signal,
                        onTokens: (n) => { totalTokens += n; },
                        onPausedMs: (ms) => { pausedMs += ms; },
                    });
                    // 병렬 fan-out(spawn_agents) — 플래그 ON 시에만 도구 노출(undefined 면 미노출).
                    const spawnFn = AGENT_SPAWN.ENABLED
                        ? buildTaskSpawnFn({
                            client: this.client, userId, taskId, userCtx, sandboxCfg, mcpTools, signal,
                            onTokens: (n) => { totalTokens += n; },
                            onPausedMs: (ms) => { pausedMs += ms; },
                        })
                        : undefined;
                    taskRuntime = new TaskRuntime(taskId, userId, sandboxCfg, delegateFn, spawnFn);
                    await taskRuntime.create();
                    await db.updateAgentTask(taskId, {
                        sandboxContainerId: taskRuntime.containerName,
                        workspacePath: taskRuntime.workspacePath,
                    });
                    // 새 대화(resume 아님)면 system 에 작업환경 안내 주입. 이어서 Phase 2 Git: repo 지정 시 호스트 clone(토큰 컨테이너 미주입)+안내.
                    if (!input.resume && conversation[0]?.role === 'system') {
                        conversation[0].content += getTaskSandboxGuidance();
                    }
                    await setupTaskRepo(taskRuntime, input, userId, conversation);
                    logger.info(`[AgentTask] 샌드박스 활성 (${taskId}, ${taskRuntime.containerName})`);
                } catch (e) {
                    logger.warn(`[AgentTask] 샌드박스 생성 실패 — 미사용 진행: ${e instanceof Error ? e.message : e}`);
                    taskRuntime = null;
                }
            }
            // 입력 첨부 주입 — 파일은 샌드박스 있으면 workspace(uploads/)에 기록(셸/파이썬으로 읽음), 없으면
            // goal 에 fileContext 주입. 이미지는 goal vision 채널(+샌드박스면 원본 바이트도). workspace 는
            // 실패/취소 시 삭제되므로 resume 에서 재기록(멱등 overwrite). goal 주입은 신규 시작 한정.
            const inputFiles = (input.files ?? []).filter((f) => !!f && typeof f.name === 'string');
            const inputImages = (input.images ?? []).filter((s) => typeof s === 'string' && s.length > 0);
            if (inputFiles.length > 0 || inputImages.length > 0) {
                const goalMsg = input.resume ? undefined : conversation.find((m) => m.role === 'user');
                if (goalMsg && inputImages.length > 0) goalMsg.images = inputImages;
                if (taskRuntime) {
                    const lines = await writeInputFilesToWorkspace(taskRuntime, inputFiles, inputImages);
                    if (goalMsg && lines.length > 0) goalMsg.content += getAgentTaskUploadedFilesNote(lines);
                } else if (goalMsg && inputFiles.length > 0) {
                    // 샌드박스 OFF/degrade — 채팅과 동일한 fileContext 주입(캡 포함).
                    goalMsg.content += buildFileContext(inputFiles);
                }
            }
            // 코드 작업 diff 캡처(openmake_code v1) — 첨부까지 기록된 시점을 git baseline 스냅샷(멱등·fail-open).
            if (taskRuntime && sandboxCfg.codeDiffEnabled) await initWorkspaceBaseline(taskRuntime);

            // LLM 에 전달할 도구 세트 조립(샌드박스 도구 + extraTools + 2-A 동적 도구). 상세는
            // agent-task/tool-assembly. extraToolNames = 호스트 실행 도구(디스패치 승인 게이트 대상).
            const { tools, extraToolNames } = await assembleAgentTools({ mcpTools, taskRuntime, sandboxCfg, goal });

            // 스텝 실시간 발행(4-5) — DB 기록 직후 요약을 WS 로 브로드캐스트(채팅 인라인 카드의 "현재 단계").
            const emitStep = (stepType: string, toolName?: string, content?: string | null): void => {
                emitAgentTaskProgress({
                    userId, taskId, status: curStatus, progress: curProgress, currentTurn: curTurn,
                    step: { stepType, ...(toolName ? { toolName } : {}), preview: (content ?? '').slice(0, 200) },
                });
            };

            for (let turn = startTurn; turn < turnCeiling; turn++) {
                assertWithinLimits(signal, startedAt, pausedMs, totalTokens);

                // 진행률: 에이전트가 plan 을 세웠으면 실제 단계 완료율(completed/total)을 진척으로 쓴다
                // — "3/7 단계"처럼 실제 진행을 반영(1-C). plan 이 없으면(턴0·비플래닝 작업) 총 턴 수를
                // 알 수 없으므로 남은 거리의 고정 비율을 매 턴 채우는 점근 곡선으로 폴백(상한 90, 완료 100 은
                // 종료 경로가 설정). 둘 다 curProgress 아래로는 내려가지 않게 단조 증가 보장.
                const planSteps = taskRuntime?.getPlanSnapshot() ?? [];
                let nextProgress: number;
                if (planSteps.length > 0) {
                    const done = planSteps.filter((s) => s.status === 'completed').length;
                    const planPct = Math.round((done / planSteps.length) * 90);
                    nextProgress = Math.max(curProgress, Math.min(90, Math.max(2, planPct)));
                } else {
                    nextProgress = Math.min(90, curProgress + Math.max(4, Math.round((90 - curProgress) * 0.25)));
                }
                await update({ currentTurn: turn + 1, progress: nextProgress });

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

                // 실행 중 사용자 중간 지시(steering) — 이 턴 경계에 도착한 지시를 conversation 에
                // user 메시지로 주입해 방향을 조정한다. 턴 경계 소비라 tool_call_id 매칭이 유지되고
                // 다음 checkpoint 에 자연 포함된다(resume 안전). 스텝으로 기록해 상세/카드에 노출.
                stepNumber = await applyPendingSteering(taskId, turn, conversation, stepNumber, emitStep);

                // per-call abort: 작업 잔여 예산을 호출에도 바인딩 — 응답이 hang 되면
                // 턴 사이 assertWithinLimits 까지 도달하지 못하므로 호출 자체를 끊는다.
                // 승인 대기 누적(pausedMs)은 예산에서 제외(4-1 pause-aware).
                const remainingMs = Math.max(
                    1_000,
                    AGENT_TASK_LIMITS.TOTAL_TIMEOUT_MS - (Date.now() - startedAt - pausedMs)
                );
                const callSignal = AbortSignal.any([signal, AbortSignal.timeout(remainingMs)]);

                // reasoning OFF + 외부 role 모델 tools 4xx 로컬 폴백 — agent-task/role-client
                const result = await chatTurnWithRoleFallback(roleState, {
                    conversation, tools: effectiveTools, signal: callSignal,
                    taskId, userId: String(userId),
                });
                this.client = roleState.client;
                totalTokens +=
                    (result.metrics?.prompt_tokens ?? 0) + (result.metrics?.completion_tokens ?? 0);
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
                emitStep(stepType, undefined, stepContent);

                if (!hasToolCalls) {
                    // 목표 미달성 선언 판정: 모델이 마커로 "수행 불가"(입력 부재·권한 등)를 밝히면
                    // completed 대신 failed(goal_incomplete) 로 종료 — 아무것도 못 한 작업이
                    // "완료"로 표시되던 오표시를 막는다. result 에는 마커를 뗀 사유를 남긴다.
                    // (턴 0 deliverable 재촉 가드보다 먼저 — 불가 선언을 재촉으로 뭉개지 않음.)
                    if (stepContent && stepContent.includes(AGENT_TASK_INCOMPLETE_MARKER)) {
                        await update({
                            status: 'failed',
                            error: 'goal_incomplete',
                            result: stepContent.replace(AGENT_TASK_INCOMPLETE_MARKER, '').trim(),
                            checkpoint: null,
                        });
                        logger.info(`[AgentTask] 목표 미달성 종료: ${taskId} (turn ${turn + 1})`);
                        return;
                    }
                    // 턴 0 계획-만 가드: 도구가 필요 없는 목표에서 모델이 계획만 쓰고 멈추면
                    // 결과물 없이 종료된다 — deliverable(artifact) 이 없으면 1회 재촉 후 계속.
                    if (turn === startTurn && extracted!.artifacts.length === 0) {
                        conversation.push({ role: 'user', content: getAgentTaskDeliverableNudge() });
                        continue;
                    }
                    // 목표 달성 judge (마커 미준수 보완): 아티팩트 없는 최종 답변만 판정 전용
                    // LLM 1회 호출로 검증 — deliverable 아티팩트가 실재하면 생략(호출 절약).
                    // 판정 실패/파싱 불가는 fail-open(완료 유지), 미달성 확정 시에만 실패 처리.
                    // 5-3(b): 실행 컨텍스트(사용 도구·턴수·계획 상태)를 함께 제공해 판정 정확도 보강.
                    if (extracted!.artifacts.length === 0 && AGENT_TASK_LIMITS.GOAL_JUDGE_ENABLED) {
                        const execCtx = buildJudgeExecutionContext(usedTools, turn + 1, taskRuntime?.getPlanSnapshot() ?? []);
                        const achieved = await judgeGoalAchieved(
                            await judgeClientFor(String(userId)), goal, stepContent ?? '', callSignal, execCtx);
                        if (achieved === false) {
                            await update({
                                status: 'failed',
                                error: 'goal_incomplete',
                                result: stepContent,
                                checkpoint: null,
                            });
                            logger.info(`[AgentTask] judge 목표 미달성 종료: ${taskId} (turn ${turn + 1})`);
                            return;
                        }
                    }
                    // 2-B 산출물 실행 검증: 코드 deliverable 을 완료 전 문법/컴파일 검사(샌드박스 활성 시).
                    // 실패면 오류 리포트를 주입하고 1회 자가수정 유도(재시도 상한 내). 검사 대상 없음/통과/
                    // fail-open 이면 그대로 완료. 재시도 상한 초과 시엔 검증을 건너뛰고 완료(무한루프 방지).
                    if (taskRuntime
                        && AGENT_TASK_LIMITS.VERIFY_DELIVERABLE_ENABLED
                        && verifyRetries < AGENT_TASK_LIMITS.VERIFY_DELIVERABLE_MAX_RETRIES
                        && extracted!.artifacts.length > 0) {
                        const verify = await verifyCodeArtifacts(taskRuntime, extracted!.artifacts, callSignal);
                        if (!verify.ok) {
                            verifyRetries++;
                            conversation.push({ role: 'user', content: getAgentTaskVerifyFailedNudge(verify.report) });
                            logger.info(`[AgentTask] 산출물 검증 실패 → 자가수정 유도: ${taskId} (재시도 ${verifyRetries})`);
                            continue;
                        }
                    }
                    stepNumber = await persistArtifactSteps(taskId, extracted!.artifacts, stepNumber);
                    stepNumber = await maybePersistCodeDiff(taskRuntime, sandboxCfg, taskId, stepNumber, emitStep);
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
                    usedTools.add(name);
                    if (isSearchTool(name)) searchCalls++;
                    if (name === 'browser') browserCalls++;
                    const args = (tc.function.arguments ?? {}) as Record<string, unknown>;
                    let toolResult: string;
                    if (taskRuntime?.isTaskTool(name)) {
                        // task 도구 — 승인 게이트 통과 후 영속 샌드박스에서 실행.
                        // onApprovalWaited: 승인 대기 시간을 pausedMs 로 누적(4-1 pause-aware 타임아웃).
                        toolResult = await taskRuntime.executeTaskTool(name, args, {
                            signal,
                            onApprovalPending: (p) => onApprovalPending(p.toolName),
                            onApprovalWaited: (ms) => { pausedMs += ms; },
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
                        let decision: 'approved' | 'rejected' = 'approved';
                        if (requiresApproval(sandboxCfg.approvalPolicy, name, args)) {
                            const r = await getApprovalRegistry().request(
                                { taskId, userId, toolName: name, args },
                                { timeoutMs: sandboxCfg.approvalTimeoutMs, signal, onPending: (p) => onApprovalPending(p.toolName) },
                            );
                            decision = r.decision;
                            pausedMs += r.waitedMs; // 4-1 pause-aware
                        }
                        if (curStatus === 'paused') await update({ status: 'running' }).catch(() => { /* noop */ });
                        toolResult = decision === 'approved'
                            ? await runTool(mcp, name, args, userCtx)
                            : `Error: 사용자가 도구 실행을 승인하지 않았습니다 (${name}). 다른 방법을 시도하거나 작업을 종료하세요.`;
                    } else {
                        toolResult = await runTool(mcp, name, args, userCtx);
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
                    emitStep('tool_result', name, toolResult);
                    // 턴 중간 체크포인트(6-4, opt-in): 도구 결과 단위로 저장 — 이 시점 conversation 은
                    // assistant(tool_calls)+실행된 tool 결과들로 유효하며, resume 이 같은 턴(fromTurn=turn)
                    // 에서 LLM 호출로 자연 이어져 이미 실행된 도구(특히 write)를 재실행하지 않는다.
                    if (AGENT_TASK_LIMITS.MIDTURN_CHECKPOINT_ENABLED) {
                        await db.updateAgentTask(taskId, {
                            checkpoint: { conversation, completedTurn: turn - 1 },
                        }).catch(() => { /* checkpoint 실패는 실행을 막지 않음 */ });
                    }
                }

                // terminate 도구 호출 — 깔끔한 완료 시그널(max_turns 소진 아님).
                if (terminated) {
                    const ex = extractAndStripArtifacts(result.content ?? '');
                    stepNumber = await persistArtifactSteps(taskId, ex.artifacts, stepNumber);
                    stepNumber = await maybePersistCodeDiff(taskRuntime, sandboxCfg, taskId, stepNumber, emitStep);
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
            stepNumber = await persistArtifactSteps(taskId, lastExtracted.artifacts, stepNumber);
            stepNumber = await maybePersistCodeDiff(taskRuntime, sandboxCfg, taskId, stepNumber, emitStep);
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
            // task 자동승인(4-2) 해제 — 종료된 task 의 플래그가 레지스트리에 잔존하지 않게.
            getApprovalRegistry().clearAutoApprove(taskId);
            // 미소비 steering 정리 — 종료된 task 에 남은 지시가 다음 동명 실행에 새지 않게.
            getSteeringRegistry().clear(taskId);
            if (taskRuntime) {
                // 완료 시 workspace 보존(다운로드용), 실패/취소 시 삭제 직전 코드 diff 캡처(실패한 코드 작업도 변경분 검토).
                const keepWorkspace = curStatus === 'completed';
                if (!keepWorkspace) await captureDiffOnCleanup(taskRuntime, taskId, stepNumber).catch(() => { /* fail-open */ });
                await taskRuntime.cleanup(!keepWorkspace).catch((e) =>
                    logger.warn(`[AgentTask] 샌드박스 정리 실패: ${taskId} — ${e}`));
            }
        }
    }
}
