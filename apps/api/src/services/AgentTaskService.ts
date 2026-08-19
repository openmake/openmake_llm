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
import { initAgentRoleState, chatTurnWithRoleFallback, defaultAgentClient } from './agent-task/role-client';
import { getUnifiedMCPClient } from '../mcp/unified-client';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { AGENT_TASK_LIMITS, AGENT_SPAWN } from '../config/runtime-limits';
import { emitAgentTaskProgress } from '../utils/event-bus';
import { getAgentTaskDeliverableNudge, getAgentTaskStuckNudge, getTaskSandboxGuidance, getWorktreeIsolationNote, getAgentTaskUploadedFilesNote, AGENT_TASK_INCOMPLETE_MARKER } from '../prompts/agent-task-prompt';
import { extractAndStripArtifacts } from '../llm/artifact-parser';
import { applyReportRender } from './chat-service/report-block';
import { getPushService } from './PushService';
import { createLogger } from '../utils/logger';
import type { UserContext } from '../mcp/user-sandbox';
import { getSkillManager } from '../agents/skill-manager';
import { buildDelegateFn } from './agent-task/delegate';
import { buildTaskSpawnFn } from './agent-spawn/spawn-agents';
import { mergeToolsWithSkills, type ActiveSkillBinding } from './chat-service/tool-merger';
import { filterRestrictedTools } from './chat-service/tool-restrictions';
import { TaskRuntime } from './task-sandbox/runtime';
import { getApprovalRegistry } from './task-sandbox/approval-gate';
import { currentPlanStepIndex } from './task-sandbox/planning';
import { applyTurnResourceGates, shouldAdoptFinalTurnAnswer, type TurnGateFlags } from './agent-task/turn-gate';
import { buildFileContext } from './chat-service/attach-context';
import { AgentTaskAbort, assertWithinLimits, type AgentTaskRunInput } from './agent-task/types';
import { writeInputFilesToWorkspace } from './agent-task/task-inputs';
import { finalizeTask } from './agent-task/finalize';
import { buildJudgeToolEvidence } from './agent-task/goal-judge';
import { persistArtifactSteps } from './agent-task/task-steps';
import { initWorkspaceBaseline, maybePersistCodeDiff, captureDiffOnCleanup } from './agent-task/code-diff';
import { getSteeringRegistry, applyPendingSteering } from './agent-task/steering';
import { resolveExecutorPlan } from './agent-task/executor-select';
import { recoverTextToolCalls } from './agent-task/text-tool-calls';
import { executeTurnToolCalls } from './agent-task/turn-executor';
import { prepareToolArgs } from './agent-task/tool-args';
import { assembleAgentTools } from './agent-task/tool-assembly';
import { buildAgentTaskSystemContent, resolveSkillToolBindings } from './agent-task/skill-block';

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
        // 총 타임아웃 예산 — 예약(무인) task 는 input.totalTimeoutMs 로 더 긴 예산을 받는다(기본 전역값).
        const totalTimeoutMs = input.totalTimeoutMs ?? AGENT_TASK_LIMITS.TOTAL_TIMEOUT_MS;
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
        let browserCalls = 0;
        // HITL 무응답 강등: 승인 timeout(명시 거절 아님) 누적 — 임계 도달 시 승인 필요 도구 제거.
        let approvalTimeouts = 0;
        // 턴 자원 가드의 "1회 nudge" 플래그 — turn-gate 가 제자리 갱신.
        const gateFlags: TurnGateFlags = {
            searchLimitNotified: false, browserLimitNotified: false,
            finalTurnNotified: false, approvalDegradeNotified: false,
        };
        let curStatus = 'pending';
        let curProgress = 0;
        let curTurn = 0;
        let taskRuntime: TaskRuntime | null = null;
        const recentSignatures: string[] = [];
        let stuckNotified = false;
        let verifyRetries = 0;
        // 5-3(b): 실제 사용한 도구 추적 — goal judge 의 실행 컨텍스트(수행 흔적)로 전달.
        const usedTools = new Set<string>();
        // 스텝→플랜 노드 귀속(088): 기록 시점의 in_progress 단계 인덱스(결정적, 추정 귀속 없음).
        const planIdx = (): number | undefined =>
            taskRuntime ? currentPlanStepIndex(taskRuntime.getPlanSnapshot()) : undefined;

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

            // resume 은 checkpoint(end-of-turn conversation)에서 복원, 새 시작은 system 에 활성 스킬
            // 지식(prompt_md)+크로스-task 학습(5-2, 플래그 OFF/실패 시 '') 주입. resume 은 old system 유지.
            const conversation: ChatMessage[] = input.resume
                ? [...input.resume.conversation]
                : [
                    {
                        role: 'system',
                        content: await buildAgentTaskSystemContent(userId, goal, taskId),
                    },
                    { role: 'user', content: goal },
                ];
            const startTurn = input.resume?.fromTurn ?? 0;

            // fresh 재실행 시 이전 시도의 checkpoint 도 함께 리셋 — 남겨두면 turn 1 완료 전
            // 재실패 시 resumable=true 로 남아 Resume 이 예전 대화를 이어가는 혼선이 생긴다.
            await update({ status: 'running', progress: 2, ...(input.resume ? {} : { checkpoint: null }) });
            // fresh 재실행(실패/취소 작업을 처음부터): 이전 시도의 스텝을 비워
            // stepNumber 0 재시작으로 인한 (task_id, step_number) 중복·표시 혼선을 방지.
            if (!input.resume) await db.deleteAgentTaskSteps(taskId);

            // 역할 게이팅(채팅 경로와 동일) — 고위험 전역 도구(Python REPL 등)를 역할 미달 user 에게서 제거.
            const allTools = filterRestrictedTools((await mcp.getToolRouter().getLLMTools({
                userId,
            })) as unknown as ToolDefinition[], userRole);

            // 활성 스킬(global+user)의 tool_bindings 머지 — 상세는 agent-task/skill-block.
            const { mcpTools, skillBindings } = await resolveSkillToolBindings({
                userId, allTools, ...(allowedSkills ? { allowedSkills } : {}),
            });

            // 영속 샌드박스(Manus화, 플래그 ON 시만). 생성 실패는 샌드박스 없이 진행(graceful degrade).
            // 설정은 한 번만 읽어 스냅샷 공유. 승인 3모드는 input.approvalPolicy 로 이 실행에만 override
            // (비영속, resume은 전역 폴백; requiresApproval 호출부 2곳이 이 cfg 를 읽어 단일 지점 주입).
            // Cowork D1a: 실행 백엔드(docker/local)·승인 정책 결정 — 상세는 agent-task/executor-select.
            const { sandboxCfg, runtimeEnabled, remoteExecutor } = resolveExecutorPlan(input, taskId, userId);
            if (runtimeEnabled) {
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
                    taskRuntime = new TaskRuntime(taskId, userId, sandboxCfg, delegateFn, spawnFn, remoteExecutor);
                    await taskRuntime.create();
                    await db.updateAgentTask(taskId, {
                        sandboxContainerId: taskRuntime.containerName,
                        workspacePath: taskRuntime.localWorkdir ?? undefined,
                    });
                    // 새 대화(resume 아님)면 system 에 작업환경 안내 주입.
                    if (!input.resume && conversation[0]?.role === 'system') {
                        conversation[0].content += getTaskSandboxGuidance();
                        // 로컬 실행기 worktree 격리가 걸렸으면 작업 브랜치를 알린다(사용자 검토 지점).
                        const isolated = remoteExecutor?.isolatedBranch;
                        if (isolated) conversation[0].content += getWorktreeIsolationNote(isolated);
                    }
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
            // injectedSkillIds: 시스템 프롬프트로 전문 주입된 스킬은 load_skill 카탈로그에서 제외
            // (채팅 경로가 활성 바인딩을 제외하는 것과 동일 규칙 — 중복 노출 방지).
            const { tools, extraToolNames } = await assembleAgentTools({
                mcpTools, taskRuntime, sandboxCfg, goal,
                injectedSkillIds: new Set(skillBindings.map((b) => b.skill_id)),
                userId,
            });

            // 스텝 실시간 발행(4-5) — DB 기록 직후 요약을 WS 로 브로드캐스트(채팅 인라인 카드의 "현재 단계").
            const emitStep = (stepType: string, toolName?: string, content?: string | null): void => {
                emitAgentTaskProgress({
                    userId, taskId, status: curStatus, progress: curProgress, currentTurn: curTurn,
                    step: { stepType, ...(toolName ? { toolName } : {}), preview: (content ?? '').slice(0, 200) },
                });
            };

            for (let turn = startTurn; turn < turnCeiling; turn++) {
                assertWithinLimits(signal, startedAt, pausedMs, totalTokens, totalTimeoutMs);

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

                // 턴 자원 가드(검색/브라우저 cap·마무리 턴·HITL 무응답 강등) — 도구 세트 축소 +
                // 최초 발동 시 nudge 주입·스텝 기록. 판정 근거는 agent-task/turn-gate 참고.
                const gate = await applyTurnResourceGates({
                    taskId, turn, startTurn, turnCeiling, totalTokens,
                    searchCalls, browserCalls, approvalTimeouts,
                    tools, sandboxCfg, conversation, flags: gateFlags, stepNumber, emitStep,
                });
                stepNumber = gate.stepNumber;
                const { effectiveTools, finalTurnReason } = gate;

                // 실행 중 사용자 중간 지시(steering) — 이 턴 경계에 도착한 지시를 conversation 에
                // user 메시지로 주입해 방향을 조정한다. 턴 경계 소비라 tool_call_id 매칭이 유지되고
                // 다음 checkpoint 에 자연 포함된다(resume 안전). 스텝으로 기록해 상세/카드에 노출.
                stepNumber = await applyPendingSteering(taskId, turn, conversation, stepNumber, emitStep);

                // per-call abort: 작업 잔여 예산을 호출에도 바인딩 — 응답이 hang 되면
                // 턴 사이 assertWithinLimits 까지 도달하지 못하므로 호출 자체를 끊는다.
                // 승인 대기 누적(pausedMs)은 예산에서 제외(4-1 pause-aware).
                const remainingMs = Math.max(
                    1_000,
                    totalTimeoutMs - (Date.now() - startedAt - pausedMs)
                );
                const callSignal = AbortSignal.any([signal, AbortSignal.timeout(remainingMs)]);

                // reasoning OFF + 외부 role 모델 tools 4xx 로컬 폴백 — agent-task/role-client
                const result = await chatTurnWithRoleFallback(roleState, {
                    conversation, tools: effectiveTools, signal: callSignal,
                    taskId, userId: String(userId),
                    // 일시적 오류 재시도를 스텝으로 남긴다 — 발동 빈도·사유를 DB 로 집계(fail-open).
                    onRetry: ({ attempt, maxAttempts, error }) => {
                        const note = `일시적 LLM 오류 — 재시도 ${attempt}/${maxAttempts}: ${error}`;
                        void db.addAgentTaskStep({ taskId, stepNumber: stepNumber++, stepType: 'retry', content: note, planStepIndex: planIdx() })
                            .catch(() => { /* 관측 실패가 작업을 죽이지 않게 fail-open */ });
                        emitStep('retry', undefined, note);
                    },
                });
                this.client = roleState.client;
                totalTokens +=
                    (result.metrics?.prompt_tokens ?? 0) + (result.metrics?.completion_tokens ?? 0);
                // 토큰 상한을 호출 직후 즉시 검사 — 큰 도구 결과로 컨텍스트가 부풀어
                // 한도를 넘겼을 때 다음 턴까지 기다리지 않고 바로 중단(runaway 방어 강화).
                if (totalTokens > AGENT_TASK_LIMITS.MAX_TOTAL_TOKENS) {
                    throw new AgentTaskAbort('token_limit');
                }

                // 마무리 턴(도구 차단): effectiveTools=[] 로 호출했어도 모델이 native tool_calls 를
                // 뱉거나 XML 텍스트로 도구를 호출(아래 recoverTextToolCalls 가 승격)하면 도구가 실행돼
                // 최종 정리가 무산된다. finalTurnReason 이면 그 호출을 실행하지 않는다 — 남은 턴이
                // 있으면(토큰 사유) 도구 없는 다음 턴에서 답변을 유도하고, 마지막 턴이면 도구 없이 끝나
                // turn 상한 종료(재개 가능)로 떨어진다(도구만 부른 응답을 "완료"로 오표시하지 않음).
                // tool_calls 는 남기지 않는다 — tool 결과 없이 dangling 되면 resume/렌더 정합이 깨진다.
                const finalTurnHasNativeTools = !!(result.tool_calls && result.tool_calls.length > 0);
                const finalTurnHasTextTools = !!finalTurnReason && !finalTurnHasNativeTools
                    && !!result.content && recoverTextToolCalls(result.content).length > 0;
                // 실질 답변 채택: 도구 호출이 섞였어도 본문이 충분하면 그 텍스트를 최종 답변으로 삼는다.
                // 종전엔 응답 전체를 버려서, 산출물을 다 만들어 놓고 마지막 턴에 도구를 한 번 더 부르려 한
                // 작업이 max_turns_exhausted 로 실패 기록됐다(2026-08-08 예약 리포트: 렌더 완료된 36KB
                // report.html 이 게시되지 못하고 workspace 와 함께 폐기). 텍스트 도구 호출(XML) 케이스는
                // 본문 자체가 도구 호출문이라 채택하지 않는다 — native tool_calls 만 버리고 본문을 살린다.
                const finalTurnAnswerLen = (result.content ?? '').trim().length;
                const finalTurnAnswerUsable = shouldAdoptFinalTurnAnswer({
                    finalTurn: !!finalTurnReason,
                    hasNativeTools: finalTurnHasNativeTools,
                    hasTextTools: finalTurnHasTextTools,
                    answerLength: finalTurnAnswerLen,
                });
                if (finalTurnReason && (finalTurnHasNativeTools || finalTurnHasTextTools) && !finalTurnAnswerUsable) {
                    logger.info(`[AgentTask] 마무리 턴 도구 호출 무시: ${taskId} (turn ${turn + 1})`);
                    conversation.push({ role: 'assistant', content: result.content });
                    const stType = turn === 0 ? 'plan' : 'assistant';
                    await db.addAgentTaskStep({ taskId, stepNumber: stepNumber++, stepType: stType, content: result.content });
                    emitStep(stType, undefined, result.content);
                    continue;
                }
                if (finalTurnAnswerUsable) {
                    // 도구 호출만 떨궈 아래 최종 답변 경로(finalize 관문)로 자연 진입시킨다.
                    logger.info(`[AgentTask] 마무리 턴 도구 호출 폐기·본문 채택: ${taskId} `
                        + `(turn ${turn + 1}, ${finalTurnAnswerLen}자, 폐기 ${result.tool_calls!.length}건)`);
                    result.tool_calls = undefined;
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

                // qwen 결함 보정: 구조화 tool_calls 없이 도구 호출을 XML 텍스트로 뱉으면 실행이 안 돼
                // 파일이 안 만들어진다(→ 다운로드할 산출물 없음) — 파싱해 실 tool_calls 로 승격 후 실행.
                // 마무리 턴은 위 도구 차단 가드에서 이미 continue 로 처리되므로 여기 도달하지 않는다.
                if ((!result.tool_calls || result.tool_calls.length === 0) && result.content) {
                    const recovered = recoverTextToolCalls(result.content);
                    if (recovered.length > 0) { result.tool_calls = recovered; result.content = ''; }
                }
                const hasToolCalls = !!result.tool_calls && result.tool_calls.length > 0;

                // 최종 답변 턴이면 deliverable(<artifact> 태그) 추출 — 스텝/result 는
                // cleaned 본문으로 기록하고, 아티팩트는 step_type='artifact' 행으로 영속화.
                // reportdata 블록은 추출 **전에** 고정 템플릿으로 렌더해 <artifact> 로 변환
                // (P1 Phase 2 — 렌더 없인 fence-fallback 이 원본 JSON 을 code 아티팩트로 오영속).
                const extracted = hasToolCalls ? null : extractAndStripArtifacts(applyReportRender(result.content ?? ''));
                const stepContent = extracted ? extracted.cleanedContent : result.content;

                // 스텝 기록(display용). 첫 턴은 목표 분해 계획(plan)으로 표시.
                // resume 복원 상태(turn>0)는 plan 이 아님 — 중간 재개이므로 자동 제외됨.
                const stepType = turn === 0
                    ? 'plan'
                    : (hasToolCalls ? 'assistant_tool_call' : 'assistant');
                // 턴이 호출한 도구명 기록(콤마 결합) — 실행 결과는 tool_result 행에 남지만,
                // 중단/거부로 실행되지 않은 호출 의도까지 남겨 턴 단위 집계를 가능하게 한다.
                const turnToolNames = hasToolCalls
                    ? result.tool_calls!.map((tc) => tc.function.name).join(',')
                    : undefined;
                await db.addAgentTaskStep({
                    taskId,
                    stepNumber: stepNumber++,
                    stepType,
                    toolName: turnToolNames,
                    content: stepContent,
                    planStepIndex: planIdx(),
                    // 호출 의도의 인자까지 영속(091) — 중단·거부로 실행되지 않아 tool_result 행이
                    // 남지 않는 호출도 사후에 복기할 수 있게 한다(tool_name 영속과 같은 취지).
                    toolArgs: hasToolCalls
                        ? prepareToolArgs(result.tool_calls!.map((tc) => ({ name: tc.function.name, args: tc.function.arguments })))
                        : undefined,
                });
                emitStep(stepType, turnToolNames, stepContent);

                if (!hasToolCalls) {
                    // 턴 0 계획-만 가드: 도구가 필요 없는 목표에서 모델이 계획만 쓰고 멈추면
                    // 결과물 없이 종료된다 — deliverable(artifact) 이 없으면 1회 재촉 후 계속.
                    // 단 모델이 수행 불가를 선언(마커)했으면 재촉하지 않고 관문으로 보낸다
                    // (재촉이 불가 선언을 뭉개면 미달성이 completed 로 흘러간다).
                    if (turn === startTurn && extracted!.artifacts.length === 0
                        && !(stepContent && stepContent.includes(AGENT_TASK_INCOMPLETE_MARKER))) {
                        conversation.push({ role: 'user', content: getAgentTaskDeliverableNudge() });
                        continue;
                    }
                    // 완료 판정은 finalizeTask 단일 관문 — 마커·verify·judge·산출물 영속(091).
                    const fin = await finalizeTask({
                        taskId, goal, userId: String(userId), path: 'final_answer',
                        rawContent: result.content ?? '',
                        taskRuntime, sandboxCfg, usedTools, toolEvidence: buildJudgeToolEvidence(conversation), turn, stepNumber, verifyRetries,
                        signal: callSignal, update, emitStep,
                    });
                    stepNumber = fin.stepNumber;
                    if (fin.kind === 'verify_retry') {
                        verifyRetries++;
                        conversation.push({ role: 'user', content: fin.nudge });
                        continue;
                    }
                    return;
                }

                // 도구 실행 + 체크포인트 — 승인 게이트·terminate 감지·스텝 영속은 agent-task/turn-executor.
                // conversation·usedTools 는 제자리 갱신, 카운터/terminate 상태는 반환값으로 넘겨받는다.
                const turnExec = await executeTurnToolCalls({
                    toolCalls: result.tool_calls!,
                    taskRuntime, sandboxCfg, extraToolNames, mcp, userCtx,
                    userId: String(userId), taskId, turn, conversation, usedTools, signal,
                    stepNumber, searchCalls, browserCalls, pausedMs, approvalTimeouts,
                    getCurStatus: () => curStatus,
                    update, emitStep,
                });
                stepNumber = turnExec.stepNumber;
                searchCalls = turnExec.searchCalls;
                browserCalls = turnExec.browserCalls;
                pausedMs = turnExec.pausedMs;
                approvalTimeouts = turnExec.approvalTimeouts;
                const { terminated, terminateSummary } = turnExec;

                // terminate 도구 호출 — 깔끔한 완료 시그널(max_turns 소진 아님).
                // 종전엔 이 경로가 판정 없이 바로 completed 였다(빈 terminate 로 산출물 0 완료가
                // 라이브 재현). 최종 답변 경로와 같은 관문을 지나게 한다(091).
                if (terminated) {
                    const fin = await finalizeTask({
                        taskId, goal, userId: String(userId), path: 'terminate',
                        rawContent: result.content ?? '', terminateSummary,
                        taskRuntime, sandboxCfg, usedTools, toolEvidence: buildJudgeToolEvidence(conversation), turn, stepNumber, verifyRetries,
                        signal: callSignal, update, emitStep,
                    });
                    stepNumber = fin.stepNumber;
                    if (fin.kind === 'verify_retry') {
                        verifyRetries++;
                        conversation.push({ role: 'user', content: fin.nudge });
                        continue;
                    }
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

            // 턴 상한 도달 — **완주가 아니다**. terminate 경로(위)와 달리 모델이 작업을 끝냈다고
            // 선언한 적이 없고, 마지막 턴이 문장 중간에서 끊기는 것이 보통이다.
            // 종전에는 이 경로도 completed·progress 100·checkpoint null 로 기록해서
            //   ① 사용자에게 빈/절단된 결과가 "완료"로 표시되고
            //   ② resumable(= checkpoint 존재 && status==='failed', agent-task.routes)이 false 가 되어
            //      턴이 모자라 끊긴 작업을 **이어할 수조차 없었다**
            // (2026-08-02 실측: 9.5K 자 설계 문서 작업이 10턴·233K 토큰을 쓰고 "JSON이 유효한지
            //  검증하겠습니다." 에서 끊겼는데 completed 로 기록됨).
            // goal judge 의 "아무것도 못 했는데 완료" 차단과 같은 원칙으로 failed 로 기록하고,
            // 체크포인트를 남겨 이어하기를 연다(마지막 end-of-turn checkpoint 는 위 루프에서 저장됨).
            //
            // ⚠️ 2026-08-03 이후 이 경로는 **드물다** — 마지막 턴은 도구를 뺀 마무리 턴으로 전환되므로
            // 모델이 최종 답변을 내고 위 완료 경로에서 return 하는 것이 정상이다. 여기 도달한다는 건
            // 마무리 턴에서도 도구 호출을 시도했거나(도구가 없으니 이례적) 응답이 비었다는 뜻이라
            // failed 가 맞다. 마무리 턴 도입 전에는 산출물을 만든 작업까지 이 경로로 떨어져
            // 사족에서 절단됐다(예약 리포트 20/20 3건 중 2건).
            const lastAssistant = [...conversation].reverse().find((m) => m.role === 'assistant');
            const lastRaw = (lastAssistant?.content as string) || '(최대 턴에 도달하여 종료되었습니다.)';
            const lastExtracted = extractAndStripArtifacts(applyReportRender(lastRaw));
            stepNumber = await persistArtifactSteps(taskId, lastExtracted.artifacts, stepNumber);
            stepNumber = await maybePersistCodeDiff(taskRuntime, sandboxCfg, taskId, stepNumber, emitStep);
            await update({
                status: 'failed',
                error: 'max_turns_exhausted',
                result: lastExtracted.cleanedContent || lastRaw,
            });
            logger.warn(`[AgentTask] 턴 상한 종료(미완주): ${taskId} (${turnCeiling} 턴) — `
                + '재개하려면 max_turns 를 올려 resume 하세요.');
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
