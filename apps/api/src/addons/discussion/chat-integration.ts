/**
 * discussion add-on — 채팅 턴 통합 (2026-09-19, 종전 chat-service/orchestration-dispatch 의 토론 부분).
 *
 * 인라인 토론 도구 `start_discussion`: 의도 프리필터에 걸린 턴에만 노출되고, 메인 모델의 tool_choice:auto 가
 * 같은 턴에 호출을 결정한다(별도 라우터 LLM 없음). 축소 프로파일(전문가·시간 캡)로 동기 실행해 합성 결론을 돌려준다.
 * 도구 결과에 실린 출처 블록은 모델에게 감추고 최종 응답에 정확히 1회 붙인다(모델이 요약하며 버리기 때문).
 *
 * @module addons/discussion/chat-integration
 */
import { createClient } from '../../llm';
import { INLINE_DISCUSSION } from './config';
import type { ChatMessage } from '../../llm';
import type { ToolDefinition } from '../../llm/types';
import { getModelForRole } from '../../config/model-roles';
import { ORCHESTRATION_DISPATCH, MODEL_CONTEXT_DEFAULTS } from '../../config/runtime-limits';
import { DISCUSSION_INTENT_PATTERNS } from './config';
import { createLogger } from '../../utils/logger';
import type { ChatTurnIntegration } from '../../services/chat-service/turn-integrations';
import { createDiscussionEngine, type DiscussionSearchResult } from './engine';
import { buildDiscussionSourcesBlock, extractDiscussionSources, wrapDiscussionSources } from './sources';

const logger = createLogger('OrchestrationDispatch');

export const START_DISCUSSION_TOOL_NAME = 'start_discussion';

export function buildStartDiscussionTool(): ToolDefinition {
    return {
        type: 'function',
        function: {
            name: START_DISCUSSION_TOOL_NAME,
            description: '여러 전문가의 서로 다른 관점을 모아 결론을 내야 하는 질문에 사용합니다. '
                + '찬반·장단점·다각도 비교가 요구되면 이 도구로 토론을 실행하세요 — '
                + `전문가 ${INLINE_DISCUSSION.MAX_AGENTS}명이 자동 선정되어 토론 후 합성된 결론을 반환합니다. `
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
        maxAgents: INLINE_DISCUSSION.MAX_AGENTS,
        maxRounds: 1,
        enableCrossReview: false,
        enableFactCheck: INLINE_DISCUSSION.EVIDENCE,
        enableDeepThinking: false,
        ...(params.userLanguage ? { userLanguage: params.userLanguage } : {}),
    });

    // Evidence Package 수집용 검색 함수 — 토글 경로(discussion-strategy)와 대칭.
    // 미주입 시 엔진이 근거 없이 토론하므로(종전 동작) 여기서 반드시 넘긴다.
    let webSearchFn: ((q: string, opts?: { maxResults?: number }) => Promise<DiscussionSearchResult[]>) | undefined;
    if (INLINE_DISCUSSION.EVIDENCE) {
        try {
            ({ performWebSearch: webSearchFn } = await import('../../tools/web-search'));
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
                () => rej(new Error(`토론 시간 상한(${INLINE_DISCUSSION.TIMEOUT_MS}ms) 초과`)),
                INLINE_DISCUSSION.TIMEOUT_MS,
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

export const discussionChatIntegration: ChatTurnIntegration = {
    id: 'discussion',
    blockLabel: '🔗 토론 출처',

    orchestrationTool: {
        name: START_DISCUSSION_TOOL_NAME,
        detectIntent: (message) => DISCUSSION_INTENT_PATTERNS.some((re) => re.test(message)),
        buildTool: buildStartDiscussionTool,
        promptGuideClause: 'start_discussion 은 관점이 갈리는 주제의 결론을 만들 때',
        exposureLog: '토론 의도 감지',
        run: ({ args, userLanguage, signal }) => runStartDiscussion({
            args,
            ...(userLanguage ? { userLanguage } : {}),
            ...(signal ? { signal } : {}),
        }),
    },

    // 채팅 경로와 같은 엔진을 쓴다(Evidence Package 공유 + 출처 첨부). 한 번에 40~50초가 들고 도구 스키마도
    // 늘어나므로 전용 플래그(AGENT_TASK_DISCUSSION, 기본 OFF)일 때만 에이전트 작업 스텝에 노출한다.
    agentTaskTools() {
        if (!INLINE_DISCUSSION.AGENT_TASK_ENABLED) return [];
        return [{
            tool: {
                name: START_DISCUSSION_TOOL_NAME,
                description: '여러 분야 전문가가 토론해 결론을 냅니다. 판단 기준이 상충하거나 선택지 비교가 필요한 ' +
                    '결정(설계 방식 선택, 트레이드오프 평가 등)에만 쓰세요. 사실 조회나 단순 실행에는 쓰지 마세요 — ' +
                    '수십 초가 걸립니다.',
                inputSchema: {
                    type: 'object' as const,
                    properties: { topic: { type: 'string', description: '토론 주제 (한 문장으로 명확히)' } },
                    required: ['topic'],
                },
            },
            async run(args) {
                const topic = typeof args.topic === 'string' ? args.topic.trim() : '';
                if (!topic) return { text: 'topic 이 필요합니다.', isError: true };
                try {
                    return { text: await runStartDiscussion({ args: { topic } }) };
                } catch (e) {
                    return { text: `토론 실패: ${e instanceof Error ? e.message : String(e)}`, isError: true };
                }
            },
        }];
    },

    extractBlocks: extractDiscussionSources,
};
