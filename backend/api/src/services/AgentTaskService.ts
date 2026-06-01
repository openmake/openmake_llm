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
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';
import { emitAgentTaskProgress } from '../utils/event-bus';
import { getAgentTaskSystemPrompt } from '../prompts/agent-task-prompt';
import { createLogger } from '../utils/logger';
import type { UserContext } from '../mcp/user-sandbox';

const logger = createLogger('AgentTaskService');

type UserTier = 'free' | 'pro' | 'enterprise';
type UserRole = 'admin' | 'user' | 'guest';

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
    userTier: UserTier;
    userRole: UserRole;
    maxTurns: number;
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
        const { taskId, goal, userId, userTier, userRole, maxTurns } = input;
        const db = getUnifiedDatabase();
        const mcp = getUnifiedMCPClient();
        const signal = this.abortController.signal;
        const startedAt = Date.now();
        const turnCeiling = Math.min(maxTurns, AGENT_TASK_LIMITS.MAX_TURNS_CEILING);

        const userCtx: UserContext = { userId, tier: userTier, role: userRole };

        const conversation: ChatMessage[] = [
            { role: 'system', content: getAgentTaskSystemPrompt() },
            { role: 'user', content: goal },
        ];

        let stepNumber = 0;
        let totalTokens = 0;
        let curStatus = 'pending';
        let curProgress = 0;
        let curTurn = 0;

        // DB 갱신 + 진행상황 발행(fire-and-forget). ws 계층이 구독해 owner user 에게 relay.
        // ws 를 직접 참조하지 않으므로 소켓 연결 여부와 무관하게 실행은 끝까지 진행된다.
        const update = async (u: Parameters<typeof db.updateAgentTask>[1]): Promise<void> => {
            curStatus = (u.status ?? curStatus) as string;
            curProgress = u.progress ?? curProgress;
            curTurn = u.currentTurn ?? curTurn;
            await db.updateAgentTask(taskId, u);
            emitAgentTaskProgress({ userId, taskId, status: curStatus, progress: curProgress, currentTurn: curTurn });
        };

        AgentTaskService.running.set(taskId, this);
        try {
            await update({ status: 'running', progress: 2 });

            // tier 기반 허용 도구 목록 (LLMTool ≈ ToolDefinition)
            const tools = (await mcp.getToolRouter().getLLMTools(userTier, {
                userId,
                tier: userTier,
            })) as unknown as ToolDefinition[];

            for (let turn = 0; turn < turnCeiling; turn++) {
                this.assertWithinLimits(signal, startedAt, totalTokens);

                await update({
                    currentTurn: turn + 1,
                    progress: Math.min(95, 5 + Math.round((turn / turnCeiling) * 90)),
                });

                const result = await this.client.chat(conversation, undefined, undefined, {
                    tools,
                    signal,
                });
                totalTokens +=
                    (result.metrics?.prompt_eval_count ?? 0) + (result.metrics?.eval_count ?? 0);

                conversation.push({
                    role: 'assistant',
                    content: result.content,
                    ...(result.tool_calls && { tool_calls: result.tool_calls }),
                });

                const hasToolCalls = !!result.tool_calls && result.tool_calls.length > 0;

                // 체크포인트: assistant 턴 (messages_snapshot 은 Stage 2 resume 대비)
                // 첫 턴은 목표 분해 계획(plan)으로 표시 — 시스템 프롬프트가 계획 우선 작성을 유도.
                const stepType = turn === 0
                    ? 'plan'
                    : (hasToolCalls ? 'assistant_tool_call' : 'assistant');
                await db.addAgentTaskStep({
                    taskId,
                    stepNumber: stepNumber++,
                    stepType,
                    content: result.content,
                    messagesSnapshot: conversation,
                });

                if (!hasToolCalls) {
                    await update({
                        status: 'completed',
                        progress: 100,
                        result: result.content,
                    });
                    logger.info(`[AgentTask] 완료: ${taskId} (${turn + 1} 턴, ${totalTokens} 토큰)`);
                    return;
                }

                // 도구 실행 + 체크포인트
                for (const tc of result.tool_calls!) {
                    if (signal.aborted) throw new AgentTaskAbort('aborted');
                    const name = tc.function.name;
                    const toolResult = await this.runTool(mcp, name, tc.function.arguments ?? {}, userCtx);
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
            }

            // 턴 상한 도달 — 마지막 assistant 내용을 결과로 보존
            const lastAssistant = [...conversation].reverse().find((m) => m.role === 'assistant');
            await update({
                status: 'completed',
                progress: 100,
                result: (lastAssistant?.content as string) || '(최대 턴에 도달하여 종료되었습니다.)',
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
        }
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

    /** 단일 도구 실행 — tier/sandbox 는 executeToolWithContext 가 처리. 실패는 문자열로 흡수 */
    private async runTool(
        mcp: ReturnType<typeof getUnifiedMCPClient>,
        name: string,
        args: Record<string, unknown>,
        userCtx: UserContext,
    ): Promise<string> {
        try {
            const r = await mcp.executeToolWithContext(name, args, userCtx);
            const text =
                typeof r.content === 'string' ? r.content : JSON.stringify(r.content).slice(0, 8000);
            return r.isError ? `Error: ${text}` : text;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`[AgentTask] 도구 실행 실패 (${name}): ${msg}`);
            return `Error: ${msg}`;
        }
    }
}
