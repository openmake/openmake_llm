/**
 * ============================================================
 * 오케스트레이션 자동 배정 (Stage 1) — 모델이 도구로 직접 배정
 * ============================================================
 *
 * 채팅 도구 루프에 두 도구를 의도 프리필터 게이트로 노출한다:
 *  - start_discussion: 다각 관점 토론(discussion engine 축소 프로파일)을 인라인 실행
 *  - delegate_agent_task: 장시간·파일 산출 작업을 백그라운드 에이전트 작업으로 위임
 *
 * 설계 원칙 (오케스트레이션은 앱 자체 구현 유지 — 게이트웨이는 모델 호출만 담당):
 *  - 별도 라우터 LLM 없음 — 메인 모델의 tool_choice:auto 가 같은 턴에 결정.
 *  - 상시 노출 금지 — DISCUSSION/TASK_DELEGATE_INTENT_PATTERNS 매칭 시에만 노출(도구폭주 방지).
 *  - 비용 가드 — 토론은 전문가·시간 캡, 위임 작업은 기존 승인 정책(HITL)·큐·goal judge 를 그대로 탄다.
 *  - 실행 주체는 앱 — LiteLLM 게이트웨이는 모델 호출만 담당(이중 라우팅 없음).
 *
 * @module services/chat-service/orchestration-dispatch
 */
import { randomUUID } from 'crypto';
import { createClient } from '../../llm';
import type { ChatMessage } from '../../llm';
import type { ToolDefinition } from '../../llm/types';
import type { UserContext } from '../../mcp/user-sandbox';
import { getModelForRole } from '../../config/model-roles';
import { createDiscussionEngine, type DiscussionSearchResult } from '../../agents/discussion-engine';
import { buildDiscussionSourcesBlock, wrapDiscussionSources } from '../../agents/discussion-sources';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { AgentTaskService } from '../AgentTaskService';
import { dispatchAgentTask } from '../agent-task/task-queue';
import { ORCHESTRATION_DISPATCH, MODEL_CONTEXT_DEFAULTS, AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('OrchestrationDispatch');

export const START_DISCUSSION_TOOL_NAME = 'start_discussion';
export const DELEGATE_AGENT_TASK_TOOL_NAME = 'delegate_agent_task';

export function isOrchestrationTool(name: string): boolean {
    return name === START_DISCUSSION_TOOL_NAME || name === DELEGATE_AGENT_TASK_TOOL_NAME;
}

/** 시스템 프롬프트에 주입하는 배정 가이드 — 해당 의도 프리필터 매칭 턴에만 주입된다. */
export const ORCHESTRATION_PROMPT_GUIDE =
    '\n\n[오케스트레이션 배정]\n'
    + '- 이 턴에 제공된 오케스트레이션 도구는 사용자 요청 유형과 이미 일치한다고 판단되어 노출된 것입니다. '
    + '해당 도구가 다루는 작업이면 그 도구로 처리하고, 결과를 사용자에게 정리해 전달하세요.\n'
    + '- start_discussion 은 관점이 갈리는 주제의 결론을 만들 때, delegate_agent_task 는 파일 산출·코드 실행이 '
    + '필요할 때 사용합니다.\n'
    + '- 도구가 다루지 않는 요청이면 평소처럼 직접 답하세요.';

export function buildStartDiscussionTool(): ToolDefinition {
    return {
        type: 'function',
        function: {
            name: START_DISCUSSION_TOOL_NAME,
            description: '여러 전문가의 서로 다른 관점을 모아 결론을 내야 하는 질문에 사용합니다. '
                + '찬반·장단점·다각도 비교가 요구되면 이 도구로 토론을 실행하세요 — '
                + `전문가 ${ORCHESTRATION_DISPATCH.DISCUSSION_MAX_AGENTS}명이 자동 선정되어 토론 후 합성된 결론을 반환합니다. `
                + '단순 사실 질문·설명 요청에는 사용하지 마세요.',
            parameters: {
                type: 'object',
                properties: {
                    topic: { type: 'string', description: '토론 주제 (사용자 질문을 구체적 쟁점으로 정리)' },
                },
                required: ['topic'],
            },
        },
    };
}

export function buildDelegateAgentTaskTool(): ToolDefinition {
    return {
        type: 'function',
        function: {
            name: DELEGATE_AGENT_TASK_TOOL_NAME,
            description: '파일을 만들거나 코드를 실행해야 하는 요청에 사용합니다 — 백그라운드 에이전트가 '
                + '샌드박스에서 작업을 수행하고 산출물을 남깁니다(위험 도구는 사용자 승인을 거칩니다). '
                + '엑셀·CSV·스크립트·텍스트 파일 생성 요청이면 이 도구로 위임하세요. '
                + '즉시 말로 답할 수 있는 질문에는 사용하지 마세요.',
            parameters: {
                type: 'object',
                properties: {
                    goal: { type: 'string', description: '작업 목표 — 산출물과 완료 조건을 구체적으로 기술' },
                    max_turns: { type: 'number', description: `최대 턴 수 (선택, 기본 ${AGENT_TASK_LIMITS.DEFAULT_MAX_TURNS})` },
                },
                required: ['goal'],
            },
        },
    };
}

/** start_discussion 실행 — 축소 프로파일(전문가·라운드 캡) 토론을 동기 실행해 합성 결과를 반환. */
async function runStartDiscussion(params: {
    args: Record<string, unknown>;
    userLanguage?: string;
    signal?: AbortSignal;
}): Promise<string> {
    const topic = String(params.args.topic ?? '').trim();
    if (!topic) return 'Error: topic 이 필요합니다.';

    const client = createClient({ model: getModelForRole('chat') });
    const generateResponse = async (systemPrompt: string, userMessage: string): Promise<string> => {
        if (params.signal?.aborted) throw new Error('aborted');
        let response = '';
        const chatMessages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ];
        await client.chat(chatMessages, { num_predict: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_PREDICT }, (token, thinking) => {
            if (!thinking) response += token;
            if (params.signal?.aborted) throw new Error('aborted');
        });
        return response;
    };

    const engine = createDiscussionEngine(generateResponse, {
        maxAgents: ORCHESTRATION_DISPATCH.DISCUSSION_MAX_AGENTS,
        maxRounds: 1,
        enableCrossReview: false,
        enableFactCheck: ORCHESTRATION_DISPATCH.DISCUSSION_EVIDENCE,
        enableDeepThinking: false,
        ...(params.userLanguage ? { userLanguage: params.userLanguage } : {}),
    });

    // Evidence Package 수집용 검색 함수 — 토글 경로(discussion-strategy)와 대칭.
    // 미주입 시 엔진이 근거 없이 토론하므로(종전 동작) 여기서 반드시 넘긴다.
    let webSearchFn: ((q: string, opts?: { maxResults?: number }) => Promise<DiscussionSearchResult[]>) | undefined;
    if (ORCHESTRATION_DISPATCH.DISCUSSION_EVIDENCE) {
        try {
            ({ performWebSearch: webSearchFn } = await import('../../mcp'));
        } catch {
            // fail-open — 검색 모듈이 없어도 토론 자체는 진행한다.
            logger.warn('[start_discussion] 웹 검색 모듈 로드 실패 — 근거 없이 진행');
        }
    }

    const started = Date.now();
    try {
        const result = await Promise.race([
            engine.startDiscussion(topic, webSearchFn),
            new Promise<never>((_, rej) => setTimeout(
                () => rej(new Error(`토론 시간 상한(${ORCHESTRATION_DISPATCH.DISCUSSION_TIMEOUT_MS}ms) 초과`)),
                ORCHESTRATION_DISPATCH.DISCUSSION_TIMEOUT_MS,
            )),
        ]);
        logger.info(`[start_discussion] 완료 ${Date.now() - started}ms, 참여 ${result.participants.length}명`);
        // 출처는 마커로 감싸 전달한다 — 모델이 도구 결과를 요약하며 버리므로,
        // external-provider 가 이를 뽑아 최종 응답에 결정적으로 1회 붙인다.
        const sourcesBlock = wrapDiscussionSources(
            buildDiscussionSourcesBlock(result.finalAnswer, result.sources, params.userLanguage),
        );
        // 축소 완료(최소 인원 미달)면 모델에게 알린다 — 복수 관점이 성립하지 않았으므로
        // "전문가들이 합의했다" 식으로 단정하지 않도록.
        const degradedNote = result.degraded
            ? `\n(주의: 참여 전문가가 ${result.participants.length}명뿐이라 복수 관점 비교가 제한적입니다. 합의로 단정하지 마세요.)`
            : '';
        const body = `참여 전문가: ${result.participants.join(', ')}${degradedNote}\n\n${result.finalAnswer}${sourcesBlock}`;
        return body.length > ORCHESTRATION_DISPATCH.RESULT_CAP_CHARS
            ? `${body.slice(0, ORCHESTRATION_DISPATCH.RESULT_CAP_CHARS)}\n...(길이 상한으로 잘림)`
            : body;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[start_discussion] 실패: ${msg}`);
        return `Error: 토론 실행 실패 — ${msg}. 지금까지의 지식으로 직접 답변하세요.`;
    }
}

/** delegate_agent_task 실행 — 작업 생성 + 백그라운드 디스패치(즉시 반환, HITL·큐는 기존 경로). */
async function runDelegateAgentTask(params: {
    args: Record<string, unknown>;
    userCtx: UserContext;
}): Promise<string> {
    const goal = String(params.args.goal ?? '').trim();
    if (!goal) return 'Error: goal 이 필요합니다.';
    const userId = String(params.userCtx.userId ?? '');
    if (!userId || userId === 'guest') return 'Error: 로그인된 사용자만 에이전트 작업을 위임할 수 있습니다.';

    const rawTurns = Number(params.args.max_turns);
    const maxTurns = Number.isFinite(rawTurns) && rawTurns > 0
        ? Math.min(Math.floor(rawTurns), AGENT_TASK_LIMITS.MAX_TURNS_CEILING)
        : AGENT_TASK_LIMITS.DEFAULT_MAX_TURNS;

    try {
        const taskId = randomUUID();
        const db = getUnifiedDatabase();
        await db.createAgentTask({ id: taskId, userId, goal, maxTurns });
        const service = new AgentTaskService();
        const outcome = await dispatchAgentTask({
            taskId,
            userId,
            run: () => service.execute({
                taskId,
                goal,
                userId,
                userRole: (params.userCtx.role === 'admin' ? 'admin' : 'user'),
                maxTurns,
            }),
        });
        logger.info(`[delegate_agent_task] 작업 위임: ${taskId} (${outcome})`);
        return JSON.stringify({
            task_id: taskId,
            status: outcome,
            note: '백그라운드 에이전트 작업으로 위임되었습니다. 위험 도구 사용 시 채팅/작업 페이지에 승인 요청이 표시됩니다. '
                + '진행 상황은 agent_task_get 도구 또는 "에이전트 작업" 페이지에서 확인할 수 있습니다.',
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[delegate_agent_task] 실패: ${msg}`);
        return `Error: 작업 위임 실패 — ${msg}`;
    }
}

/** 오케스트레이션 도구 실행 진입점 — 실패는 문자열로 흡수(채팅 루프를 죽이지 않음). */
export async function runOrchestrationTool(params: {
    name: string;
    args: Record<string, unknown>;
    userCtx: UserContext;
    userLanguage?: string;
    signal?: AbortSignal;
}): Promise<string> {
    if (params.name === START_DISCUSSION_TOOL_NAME) {
        return runStartDiscussion({
            args: params.args,
            ...(params.userLanguage ? { userLanguage: params.userLanguage } : {}),
            ...(params.signal ? { signal: params.signal } : {}),
        });
    }
    if (params.name === DELEGATE_AGENT_TASK_TOOL_NAME) {
        return runDelegateAgentTask({ args: params.args, userCtx: params.userCtx });
    }
    return `Error: 알 수 없는 오케스트레이션 도구 — ${params.name}`;
}
