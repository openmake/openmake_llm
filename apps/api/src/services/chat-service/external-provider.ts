/**
 * ============================================================
 * External Provider — 외부 LLM provider stream + tool calling
 * ============================================================
 *
 * ChatService 의 streamFromExternalProvider / executeExternalTool /
 * recordExternalUsageFireAndForget 3 메서드를 helper module 로 추출.
 *
 * ChatService state (lastProviderUsage / currentUserContext /
 * mcpToolResultCallback) 는 deps 객체의 callback 으로 전달 — class state
 * 의존성 0, function pure.
 *
 * @module services/chat-service/external-provider
 */
import { createLogger } from '../../utils/logger';
import { LOOP_DETECTION, AGENT_LOOP_LIMITS, MAP_INTENT_PATTERNS, SPAWN_INTENT_PATTERNS, EXTERNAL_LLM_INPUT_TOKEN_BUDGET, ORCHESTRATION_DISPATCH } from '../../config/runtime-limits';
import { estimateMessageTokens, truncateMessagesPreservingSystem } from '../../llm/model-pool';
import { type Style } from '../../chat/style';
import { buildExternalSystemPrompt } from './external-system-prompt';
import { extractDiscussionSources } from '../../agents/discussion-sources';
import { CHAT_DELEGATE_TOOL_NAME, runChatDelegate } from './chat-delegate';
import { SPAWN_AGENTS_TOOL_NAME, runChatSpawnAgents } from '../agent-spawn/spawn-agents';
import { CHAT_SUBAGENT, AGENT_SPAWN } from '../../config/runtime-limits';
import { buildExternalToolPlan, detectOrchestrationIntents } from './external-tool-plan';
import { applyWallClockGuard, applyToolOveruseGuard } from './external-loop-guards';
import { isOrchestrationTool, runOrchestrationTool } from './orchestration-dispatch';
import type { ChatMessage, ToolDefinition } from '../../llm';
import type { ChatMessageRequest } from '../chat-service-types';
import type { UserContext } from '../../mcp/user-sandbox';
import type { ResolvedProvider } from '../../providers/provider-router';
import type { ProviderRouter } from '../../providers/provider-router';

import { executeExternalTool, recordExternalUsageFireAndForget } from './external-tool-exec';

import { resolveModelCapabilities } from './model-capabilities';
import { markModelUnusableFireAndForget } from './external-model-availability';
import { appendDeterministicBlocks, captureOdArtifactHtml, normalizeOdToolCall, type OdArtifactCapture } from './external-deterministic-append';
import { OD_ARTIFACT_ECHO, IMAGE_GEN_PARALLEL } from '../../config/runtime-limits';
import { parallelBatch } from '../../workflow/graph-engine';

const logger = createLogger('ChatExternalProvider');

export interface ExternalProviderDeps {
    /** Provider router — `getExternalKeysRepo()` 등 사용 */
    providerRouter?: ProviderRouter;
    /** 현재 사용자 컨텍스트 — MCP tool 실행 sandbox 에 사용 */
    currentUserContext: UserContext | null;
    /** MCP tool 호출 결과 inline 카드 콜백 (frontend 표시용) */
    mcpToolResultCallback?: (data: { toolName: string; resources: Array<{ uri: string; mimeType?: string; text?: string }> }) => void;
    /** MCP tool 호출 시작 콜백 (frontend "실행 중" 진행 표시용) */
    mcpToolStartCallback?: (data: { toolName: string }) => void;
    /** Provider usage 누적 — ChatService.lastProviderUsage setter */
    onUsage?: (usage: import('../../llm').UsageMetrics) => void;
    /** 시스템 이벤트 콜백 — provider 폴백 고지 등 메타 알림 (WS 'system_event') */
    onSystemEvent?: (event: { type: string; message: string; metadata?: Record<string, unknown> }) => void;
    /** Allowed tools (agent 매칭 후) */
    allowedTools: ToolDefinition[];
    /** 활성 스킬이 required 로 바인딩한 도구 이름 — 도구 플랜의 distractor 억제 면제용 */
    skillRequiredToolNames?: readonly string[];
}

/**
 * TTFT 분해 계측 (2026-08-02).
 *
 * 종전 `[ChatMetrics] ttfb` 하나에 전처리·모델 prefill·도구 실행이 전부 뭉쳐 있어
 * "왜 느린지"를 가릴 수 없었다(실측 p50 4.2초인데 원인 미상). 절대 시각을 담아
 * 호출부가 구간을 계산하도록 한다 — external-provider 는 상위 시작 시각을 모르므로.
 */
export interface ChatTimings {
    /** external-provider 진입 시각 */
    enteredAt: number;
    /** 첫 LLM 호출 직전 시각 (이 앞은 프롬프트 조립·도구 계획) */
    firstLlmCallAt: number;
    /** 첫 응답 청크(content 또는 thinking) 도착 시각 — 모델 큐잉+prefill 종료점 */
    firstChunkAt: number;
    /** 도구 실행 누적(ms) — 웹검색·토론 등 */
    toolMs: number;
    /** 도구 루프 턴 수 */
    turns: number;
}

export interface StreamFromExternalContext {
    agentSystemMessage?: string;
    enhancedMessage?: string;
    resolvedLanguage?: string;
    /** Cross-conversation Memory 블록 (claude.ai Memory 동등). DYNAMIC BOUNDARY 뒤(세션별 영역)에 배치. */
    memoryBlock?: string;
    /** Custom Instructions 블록 (사용자 영구 지시). DYNAMIC BOUNDARY 뒤(세션별 영역)에 배치. */
    customInstructionsBlock?: string;
    /** Artifacts guide (디자인시스템·<artifact> 형식 지시). 가드/페르소나 뒤에 append. */
    artifactGuideBlock?: string;
    /** 응답 스타일 (concise/default/verbose). 정적 prefix 맨 앞에 style guard prepend. default 면 overhead 0. */
    style?: Style;
    /** 답변 형식 가드 (구조적 질문에 결론-우선·표·실행항목 분리). prose/concise 면 빈 문자열. */
    answerFormatBlock?: string;
    /** Tail 라우팅 Stage 2B — factual tail 판정 시 첫 턴 web_search tool_choice 강제. */
    tailWebGround?: boolean;
    /** P1 보고서 파이프라인 — 보고서 의도 턴에만 주입되는 reportdata 데이터 계약 가이드. */
    reportGuideBlock?: string;
    /** 오케스트레이션 배정 텔레메트리(Stage 2) — 스트림 종료 시 external-provider 가 채워
     *  되돌려준다(호출부가 셰도우 적재). 의도 미매칭 턴은 undefined 유지. */
    orchestrationTelemetry?: import('./orchestration-shadow-recorder').OrchestrationTelemetry;
    /** TTFT 분해 계측 — external-provider 가 채워 되돌려준다(호출부가 구간 계산·로깅). */
    timings?: ChatTimings;
}

/**
 * 외부 LLM provider stream + multi-turn tool calling.
 */
export async function runExternalStream(
    deps: ExternalProviderDeps,
    resolved: ResolvedProvider,
    req: ChatMessageRequest,
    onToken: (token: string, thinking?: string) => void,
    ctx: StreamFromExternalContext = {},
): Promise<string> {
    // TTFT 분해 계측 기준점 — 이 뒤로 프롬프트 조립·도구 계획이 진행된다.
    const enteredAtMs = Date.now();
    const messages: ChatMessage[] = [];

    // 위치/지도 의도면 카카오 도구 우선 라우팅 — 시스템 프롬프트 넛지 + 도구 강제 주입에 함께 쓰인다.
    const wantsMap = MAP_INTENT_PATTERNS.some((re) => re.test(req.message ?? ''));
    // 오케스트레이션 자동 배정 의도 — 프롬프트 가이드 주입(아래)과 도구 노출(플랜)이 공유.
    const orchestration = detectOrchestrationIntents(req.message);
    // 병렬 위임 의도 — 매칭 턴에만 spawn_agents 사용 가이드를 주입한다 (도구는 상시 노출이나
    // description 의 보수적 경고 탓에 자발 채택이 0 이던 갭 보완).
    const wantsSpawn = AGENT_SPAWN.ENABLED
        && SPAWN_INTENT_PATTERNS.some((re) => re.test(req.message ?? ''));

    // 시스템 프롬프트 조립(정적 헌법 → DYNAMIC → 가변)은 external-system-prompt 로 분리.
    const systemContent = buildExternalSystemPrompt({ req, resolved, ctx, wantsMap, orchestration, wantsSpawn });
    if (systemContent) {
        messages.push({ role: 'system', content: systemContent });
    }

    // history 에 섞인 system 은 배열에 두지 않고 맨 앞 system 에 병합한다 — 드롭하면
    // 호출자의 지시 계약이 사라지고(2026-08-20 실측), 배열에 남기면 두 번째 system 의
    // 수용 여부가 채팅 템플릿/provider 구현에 의존한다.
    // 근거 전문 + tools 요청 경로의 동일 대응: chat/external-tool-calling.ts
    const clientSystemParts: string[] = [];

    for (const h of req.history ?? []) {
        if (h.role === 'system') {
            if (h.content) clientSystemParts.push(h.content);
            continue;
        }
        const role = h.role === 'user' || h.role === 'assistant'
            ? h.role
            : 'user';
        messages.push({
            role,
            content: h.content,
            ...(h.images ? { images: h.images } : {}),
        });
    }

    if (clientSystemParts.length > 0) {
        // 자체 system 이 없는 경우(systemContent 빈 값)엔 클라이언트 system 이 맨 앞 system 이 된다.
        if (messages[0]?.role === 'system') {
            messages[0].content = [messages[0].content, ...clientSystemParts].join('\n\n');
        } else {
            messages.unshift({ role: 'system', content: clientSystemParts.join('\n\n') });
        }
    }

    messages.push({
        role: 'user',
        content: ctx.enhancedMessage || req.message,
        ...(req.images ? { images: req.images } : {}),
    });

    // 토큰 쿼터 정책(2026-07-26 결정): 이 경로는 LLMClient 를 우회하므로 로컬 쿼터
    // (LLM_HOURLY/WEEKLY_TOKEN_LIMIT)를 타지 않는다. **의도된 면제**다 — 그 한도는 로컬
    // vLLM 용량 보호용이고 외부 provider 는 사용자 본인 키·과금으로 서버 GPU 를 쓰지 않는다.
    // 비용 가시성은 external_provider_usage 기록(recordExternalUsageFireAndForget)이 담당.
    // role 경로도 같은 정책으로 맞춰져 있다 (LLMConfig.quotaExempt).

    // capability 는 카탈로그 우선으로 해석한다 — provider.getCapabilities() 는 외부의 경우
    // 모델 ID 휴리스틱이라 실제 비전 모델을 vision:false 로 오판한다(실측).
    const { caps, source: capsSource } = await resolveModelCapabilities(
        resolved, req.userId, deps.providerRouter?.getExternalKeysRepo(),
    );

    const hasImages = (req.images && req.images.length > 0)
        || (req.history ?? []).some((h) => h.images && h.images.length > 0);
    if (hasImages && !caps.vision) {
        // 휴리스틱 기반 '부정' 은 신뢰하지 않는다 — 오차단(진짜 비전 모델 400)이 실제
        // 장애였다. 이 경우 그대로 진행하고, 정말 미지원이면 upstream 오류 →
        // 로컬 폴백(withLocalFallback)이 받아낸다.
        if (capsSource === 'heuristic') {
            logger.warn(
                `[Vision] '${resolved.fullId}' vision 판정이 휴리스틱(부정) — 차단하지 않고 진행`,
            );
        } else {
            const err = new Error(
                `Model '${resolved.fullId}' does not support vision input (capabilities.vision=false, source=${capsSource}). ` +
                'Use a vision-capable model or remove images from the request.',
            );
            (err as Error & { statusCode?: number }).statusCode = 400;
            throw err;
        }
    }

    // 도구 노출·억제·첫 턴 강제 결정은 external-tool-plan 으로 분리 (동작 동일).
    const { tools, forcedFirstTurnToolName } = buildExternalToolPlan({
        allowedTools: deps.allowedTools,
        req,
        toolCalling: caps.toolCalling,
        wantsMap,
        ...(ctx.tailWebGround !== undefined ? { tailWebGround: ctx.tailWebGround } : {}),
        orchestration,
        ...(deps.skillRequiredToolNames ? { skillRequiredToolNames: deps.skillRequiredToolNames } : {}),
    });
    // Stage 2 셰도우 계측 — 의도 매칭 턴만 텔레메트리를 초기화(호출 시 아래 루프가 갱신).
    if (orchestration.discussion || orchestration.taskDelegate) {
        ctx.orchestrationTelemetry = {
            discussionIntent: orchestration.discussion,
            taskDelegateIntent: orchestration.taskDelegate,
            exposed: tools.filter((t) => isOrchestrationTool(t.function.name)).map((t) => t.function.name),
        };
    }

    const startedAt = Date.now();
    // 이미지 생성 소요시간 누적 — wall-clock 예산 공제용 (상한 WALL_CLOCK_CREDIT_MAX_MS).
    let imageGenCreditMs = 0;
    // TTFT 분해 계측 — 구간 계산은 호출부(ws-chat-handler)가 상위 시작 시각과 함께 수행.
    const timings: ChatTimings = {
        enteredAt: enteredAtMs, firstLlmCallAt: 0, firstChunkAt: 0, toolMs: 0, turns: 0,
    };
    ctx.timings = timings;
    let errorCode: string | null = null;
    let result: import('../../providers/i-provider').ChatStreamResult | undefined;
    let inputTokensTotal = 0;
    let outputTokensTotal = 0;
    let directCostUsdMicrosTotal: number | undefined;
    const MAX_TOOL_TURNS = AGENT_LOOP_LIMITS.MAX_TURNS;

    // Doom-loop 가드 (strategy 경로의 detectLoop 경량 이식):
    // 동일 도구 호출 배치가 연속 반복되면 도구를 끈 최종 턴으로 강제 전환해
    // 남은 턴 낭비 + 컨텍스트 무한 누적을 차단한다. (5턴 예산상 BREAK_AT(5)는
    // 도달 불가하므로 WARN_AT(3)를 조기 종료 트리거로 사용)
    let lastBatchSig: string | null = null;
    let repeatCount = 0;
    let suppressTools = false;
    /** 도구명별 누적 호출 수 — 인자를 바꿔가며 같은 도구를 반복하는 경우를 잡는다. */
    const toolUseCounts = new Map<string, number>();
    /** 도구별 과다 사용 경고를 이미 넣었는지 (중복 주입 방지). */
    const warnedTools = new Set<string>();
    // 채팅 서브에이전트 호출 집계 — 메시지당 캡(CHAT_SUBAGENT.MAX_CALLS) 초과 시 위임 거부.
    let delegateCalls = 0;
    // 병렬 fan-out 호출 집계 — 메시지당 캡(AGENT_SPAWN.MAX_CALLS_PER_MESSAGE) 초과 시 거부.
    let spawnCalls = 0;
    // 오케스트레이션 배정 호출 집계 — 메시지당 캡(ORCHESTRATION_DISPATCH.MAX_CALLS_PER_MESSAGE).
    let orchestrationCalls = 0;

    // generate_image 결과의 이미지 마크다운 추적 — 일부 모델(qwen 등)이 도구 지시("마크다운
    // 그대로 포함")를 누락해 생성된 이미지가 채팅에 표시되지 않는 문제 보정용.
    // 루프 종료 후 최종 응답에 누락돼 있으면 결정적으로 첨부한다.
    const generatedImageMarkdowns: string[] = [];
    // 카카오 지도: search-places 도구 결과가 동봉하는 ```kakaomap 블록을 수집한다.
    // 로컬 모델(qwen)이 블록을 답변에 옮기지 않고 요약해버려 지도가 안 뜨는 문제를
    // 위 generate_image 와 동일하게 결정적 첨부로 보정한다.
    const kakaomapBlocks: string[] = [];
    // 도구 경유 토론(start_discussion)의 출처 목록 — 모델이 도구 결과를 요약하며 버리므로
    // 마커로 실려 온 블록을 모아 최종 응답에 결정적으로 첨부한다(카카오 지도와 동일 패턴).
    const discussionSourceBlocks: string[] = [];
    // 오픈디자인 산출물(HTML) — create_artifact/write_file 인자에서 캡처, 마지막 저장본 유지.
    // 모델이 최종 응답에 <artifact> 를 생략하면 결정적 첨부한다(위 블록들과 동일 패턴).
    let odArtifact: OdArtifactCapture | null = null;

    try {
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
            // Wall-clock 예산 가드(이미지 생성 소요시간 공제) — 상세는 external-loop-guards.
            if (!suppressTools && applyWallClockGuard({ startedAt, imageGenCreditMs, messages })) {
                suppressTools = true;
            }
            const turnTools = suppressTools ? [] : tools;
            // A. context-fit 안전망: external 경로는 LLMClient.chat 의 model-pool truncate 를
            // 우회하므로, 도구 루프로 누적된 messages 가 예산을 넘으면 system 보존 + 최근 우선
            // 으로 절단한다(큰 컨텍스트가 그대로 전달돼 모델이 빈 응답을 내는 회귀의 극단 방어).
            const fittedMessages = estimateMessageTokens(messages) > EXTERNAL_LLM_INPUT_TOKEN_BUDGET
                ? truncateMessagesPreservingSystem(messages, EXTERNAL_LLM_INPUT_TOKEN_BUDGET)
                : messages;
            if (!timings.firstLlmCallAt) timings.firstLlmCallAt = Date.now();
            timings.turns++;
            result = await resolved.provider.streamChat(
                {
                    messages: fittedMessages,
                    modelId: resolved.modelId,
                    thinking: req.thinkingMode === true,
                    ...(turnTools.length > 0 ? { tools: turnTools } : {}),
                    // 첫 턴만 도구 강제(카카오 지도 또는 명시적 웹 검색) — 이후 턴은 auto(모델이 결과로 답변 작성).
                    ...(turn === 0 && forcedFirstTurnToolName && turnTools.length > 0
                        ? { tool_choice: { type: 'function' as const, function: { name: forcedFirstTurnToolName } } }
                        : {}),
                    ...(req.abortSignal ? { abortSignal: req.abortSignal } : {}),
                },
                {
                    // 첫 청크는 content·thinking 중 먼저 오는 쪽 — 모델 큐잉+prefill 종료점.
                    onToken: (token) => {
                        if (!timings.firstChunkAt) timings.firstChunkAt = Date.now();
                        onToken(token, undefined);
                    },
                    onThinking: (thinking) => {
                        if (!timings.firstChunkAt) timings.firstChunkAt = Date.now();
                        onToken('', thinking);
                    },
                    onUsage: (usage) => {
                        deps.onUsage?.(usage);
                        inputTokensTotal += usage.prompt_tokens ?? 0;
                        outputTokensTotal += usage.completion_tokens ?? 0;
                        if (usage.cost_usd_micros !== undefined) {
                            directCostUsdMicrosTotal = (directCostUsdMicrosTotal ?? 0) + usage.cost_usd_micros;
                        }
                    },
                },
            );

            if (suppressTools || !result.toolCalls || result.toolCalls.length === 0) {
                // B. 빈 응답 방어: 도구를 아직 끄지 않았는데 모델이 도구 호출도 텍스트도 없이
                // 종료하면(큰 컨텍스트에서 관측된 회귀 — 텍스트 스트리밍 0) 도구를 끈 최종 턴으로
                // 한 번 더 유도해 답변 본문을 강제한다. (재시도는 1회 — suppressTools 진입 후 break)
                const noText = !(result.content && result.content.trim());
                const noTools = !result.toolCalls || result.toolCalls.length === 0;
                if (!suppressTools && noText && noTools) {
                    logger.warn('⚠️ 외부 LLM 빈 응답(텍스트·도구 모두 없음) — 도구 비활성 최종 턴으로 답변 강제');
                    suppressTools = true;
                    messages.push({
                        role: 'user',
                        content: '답변 본문이 비어 있습니다. 추가 도구 호출 없이 사용자 요청에 대한 답변(필요 시 <artifact> 산출물 포함)을 반드시 작성하세요.',
                    });
                    continue;
                }
                break;
            }

            // 동일 도구 배치 연속 반복 감지 (name + args hash 정렬 후 비교)
            const batchSig = result.toolCalls
                .map((tc) => `${tc.name}:${JSON.stringify(tc.args).slice(0, LOOP_DETECTION.ARGS_HASH_MAX_LENGTH)}`)
                .sort()
                .join('|');
            if (batchSig === lastBatchSig) {
                repeatCount++;
            } else {
                repeatCount = 1;
                lastBatchSig = batchSig;
            }

            if (repeatCount >= LOOP_DETECTION.SAME_CALL_WARN_AT) {
                logger.warn(`🔁 외부 LLM doom-loop 감지 (동일 도구 배치 ${repeatCount}회 반복) — 도구 비활성 최종 턴으로 전환`);
                // 반복된 도구 호출은 실행하지 않고 폐기 — 도구를 끈 다음 턴에서 최종 답변 유도.
                // (assistant tool_calls 를 push 하지 않으므로 messages 정합성 유지)
                suppressTools = true;
                messages.push({
                    role: 'user',
                    content: '동일한 도구 호출이 반복되고 있습니다. 추가 도구 호출 없이 현재까지 수집한 정보로 답변을 완성하세요.',
                });
                continue;
            }

            logger.info(`🛠️ 외부 LLM tool calls (turn ${turn + 1}): ${result.toolCalls.length}개`);

            messages.push({
                role: 'assistant',
                content: result.content || '',
                tool_calls: result.toolCalls.map((tc) => ({
                    type: 'function' as const,
                    id: tc.id,
                    function: {
                        name: tc.name,
                        arguments: tc.args as Record<string, unknown>,
                    },
                })),
            });

            // 도구 실행 시간 누적 — TTFT 분해에서 "모델이 느린가 / 도구가 느린가"를 가른다.
            const toolBatchStartedAt = Date.now();
            // 이미지 생성 병렬화 — 같은 턴의 generate_image 다중 호출(발표자료 삽화 등)은
            // FLUX 디퓨전(수십 초/장)이 지배하므로 동시 실행해 배치 시간을 1장 수준으로
            // 줄인다. executeExternalTool 은 콜백·에러를 자체 처리(실패는 'Error:' 문자열)
            // 하므로 동시 실행에 안전하고, 결과는 아래 순차 루프가 원래 호출 순서대로
            // tool 메시지에 배치한다.
            const parallelImageResults = new Map<string, string>();
            const imageCalls = result.toolCalls.filter((tc) => tc.name === 'generate_image');
            if (IMAGE_GEN_PARALLEL.ENABLED && imageCalls.length >= 2) {
                logger.info(`🎨 generate_image ${imageCalls.length}건 병렬 실행 (동시 상한 ${IMAGE_GEN_PARALLEL.MAX_CONCURRENT})`);
                const imageBatchStartedAt = Date.now();
                await parallelBatch(
                    imageCalls,
                    async (tc) => {
                        parallelImageResults.set(
                            tc.id,
                            await executeExternalTool(deps, tc.name, tc.args as Record<string, unknown>),
                        );
                    },
                    { concurrency: IMAGE_GEN_PARALLEL.MAX_CONCURRENT },
                );
                imageGenCreditMs = Math.min(
                    imageGenCreditMs + (Date.now() - imageBatchStartedAt),
                    IMAGE_GEN_PARALLEL.WALL_CLOCK_CREDIT_MAX_MS,
                );
            }
            for (const tc of result.toolCalls) {
                let toolResult: string;
                if (tc.name === CHAT_DELEGATE_TOOL_NAME) {
                    // 서브에이전트 위임 — 부모 채팅 활성 도구 서브셋으로 depth=1 tool-loop.
                    deps.mcpToolStartCallback?.({ toolName: tc.name });
                    delegateCalls++;
                    toolResult = delegateCalls > CHAT_SUBAGENT.MAX_CALLS
                        ? `Error: 이 메시지의 전문가 위임 한도(${CHAT_SUBAGENT.MAX_CALLS}회)에 도달했습니다. 지금까지의 정보로 직접 답변하세요.`
                        : await runChatDelegate({
                            args: tc.args as Record<string, unknown>,
                            chatTools: tools,
                            userCtx: deps.currentUserContext ?? { userId: 'guest', role: 'guest' },
                            ...(req.abortSignal ? { signal: req.abortSignal } : {}),
                        });
                } else if (tc.name === SPAWN_AGENTS_TOOL_NAME) {
                    // 병렬 서브에이전트 fan-out — 부모 채팅 활성 도구 서브셋으로 depth=1 × N.
                    deps.mcpToolStartCallback?.({ toolName: tc.name });
                    spawnCalls++;
                    toolResult = spawnCalls > AGENT_SPAWN.MAX_CALLS_PER_MESSAGE
                        ? `Error: 이 메시지의 병렬 위임 한도(${AGENT_SPAWN.MAX_CALLS_PER_MESSAGE}회)에 도달했습니다. 지금까지의 결과로 직접 답변하세요.`
                        : await runChatSpawnAgents({
                            args: tc.args as Record<string, unknown>,
                            chatTools: tools,
                            userCtx: deps.currentUserContext ?? { userId: 'guest', role: 'guest' },
                            ...(req.abortSignal ? { signal: req.abortSignal } : {}),
                        });
                } else if (isOrchestrationTool(tc.name)) {
                    // 오케스트레이션 자동 배정 — 토론 인라인 실행 / 백그라운드 작업 위임.
                    deps.mcpToolStartCallback?.({ toolName: tc.name });
                    orchestrationCalls++;
                    toolResult = orchestrationCalls > ORCHESTRATION_DISPATCH.MAX_CALLS_PER_MESSAGE
                        ? `Error: 이 메시지의 오케스트레이션 호출 한도(${ORCHESTRATION_DISPATCH.MAX_CALLS_PER_MESSAGE}회)에 도달했습니다. 지금까지의 결과로 직접 답변하세요.`
                        : await runOrchestrationTool({
                            name: tc.name,
                            args: tc.args as Record<string, unknown>,
                            userCtx: deps.currentUserContext ?? { userId: 'guest', role: 'guest' },
                            ...(req.userLanguagePreference ? { userLanguage: req.userLanguagePreference } : {}),
                            ...(req.abortSignal ? { signal: req.abortSignal } : {}),
                        });
                    // Stage 2 셰도우 계측 — 첫 호출의 도구명·성공 여부 기록.
                    if (ctx.orchestrationTelemetry && !ctx.orchestrationTelemetry.called) {
                        ctx.orchestrationTelemetry.called = tc.name;
                        ctx.orchestrationTelemetry.success = !toolResult.startsWith('Error');
                    }
                } else {
                    // 병렬 선실행된 이미지 결과가 있으면 재실행 없이 소비.
                    // 단건 이미지 생성도 소요시간을 공제 누적한다 (배치와 동일 근거).
                    const singleImageStartedAt = tc.name === 'generate_image' && !parallelImageResults.has(tc.id)
                        ? Date.now() : 0;
                    toolResult = parallelImageResults.get(tc.id)
                        ?? await executeExternalTool(deps, tc.name, tc.args as Record<string, unknown>);
                    if (singleImageStartedAt > 0) {
                        imageGenCreditMs = Math.min(
                            imageGenCreditMs + (Date.now() - singleImageStartedAt),
                            IMAGE_GEN_PARALLEL.WALL_CLOCK_CREDIT_MAX_MS,
                        );
                    }
                }
                if (tc.name === 'generate_image') {
                    const m = toolResult.match(/!\[[^\]]*\]\(\/generated\/[^)]+\)/);
                    if (m && !generatedImageMarkdowns.includes(m[0])) {
                        generatedImageMarkdowns.push(m[0]);
                    }
                }
                // 오픈디자인 HTML 산출물 캡처 — 저장 성공한 자체완결 HTML 만, 마지막 것 유지.
                // mcp_call 메타 도구 경유 간접 호출도 server::tool 로 정규화해 동일 캡처한다.
                if (OD_ARTIFACT_ECHO.ENABLED) {
                    const eff = normalizeOdToolCall(tc.name, tc.args as Record<string, unknown>);
                    if (OD_ARTIFACT_ECHO.TOOL_NAMES.includes(eff.name)) {
                        const captured = captureOdArtifactHtml(eff.args, toolResult);
                        if (captured) odArtifact = captured;
                    }
                }
                // 카카오 지도 블록 수집(도구명 무관 — 도구 결과에 블록이 있으면).
                for (const mm of toolResult.matchAll(/```kakaomap\s*\n[\s\S]*?```/g)) {
                    if (!kakaomapBlocks.includes(mm[0])) kakaomapBlocks.push(mm[0]);
                }
                // 토론 출처 블록 추출 — 모델에게 보낼 텍스트에서는 걷어낸다(요약 대상에서 제외).
                const extracted = extractDiscussionSources(toolResult);
                for (const b of extracted.blocks) {
                    if (!discussionSourceBlocks.includes(b)) discussionSourceBlocks.push(b);
                }
                toolResult = extracted.modelFacing;
                // 모델에게는 블록을 제거한 텍스트만 전달한다 — 큰 경로 JSON 을 컨텍스트에서 보면
                // qwen 이 블록을 반복 복사(degeneration, 지도 수십개)하는 문제 차단. 지도는 아래
                // 결정적 주입으로 정확히 1회만 추가한다(모델 복사에 의존하지 않음).
                const modelFacingResult = toolResult
                    .replace(/\[지도 표시용[^\]]*\]\s*/g, '')
                    .replace(/```kakaomap\s*\n[\s\S]*?```/g, '');
                messages.push({
                    role: 'tool',
                    content: modelFacingResult,
                    tool_name: tc.name,
                    tool_call_id: tc.id,
                });
            }
            timings.toolMs += Date.now() - toolBatchStartedAt;

            // 같은 도구 반복 사용 가드 (인자 무관, WARN/BREAK) — 상세는 external-loop-guards.
            if (applyToolOveruseGuard({ toolCalls: result.toolCalls, toolUseCounts, warnedTools, messages })) {
                suppressTools = true;
                continue;
            }
        }
        if (!result) throw new Error('streamChat 호출 결과 없음');

        // C. 턴 소진 방어: 마지막 턴까지 도구 호출로 끝나면(리서치형 요청이 전 턴을 도구에
        // 소진) 최종 답변 본문이 없어 빈/스텁 content 가 반환된다 — wall-clock·doom-loop
        // 가드와 동일하게 도구를 끈 마무리 턴을 1회 실행해 답변을 강제한다.
        if (result.toolCalls && result.toolCalls.length > 0) {
            logger.warn(`⏳ 외부 LLM 턴 예산 소진(${MAX_TOOL_TURNS}턴) — 도구 비활성 최종 턴으로 답변 강제`);
            messages.push({
                role: 'user',
                content: '도구 호출 한도에 도달했습니다. 추가 도구 호출 없이 지금까지 수집한 정보로 사용자 요청에 대한 답변(필요 시 <artifact> 산출물 포함)을 반드시 완성하세요. (이 제한은 이번 응답 1회에만 적용되는 일시 조치입니다 — 당신의 웹 검색·도구 능력이 사라진 것이 아니므로, 답변에서 "검색 불가/오프라인"이라고 말하지 마세요.)',
            });
            const fittedFinal = estimateMessageTokens(messages) > EXTERNAL_LLM_INPUT_TOKEN_BUDGET
                ? truncateMessagesPreservingSystem(messages, EXTERNAL_LLM_INPUT_TOKEN_BUDGET)
                : messages;
            result = await resolved.provider.streamChat(
                {
                    messages: fittedFinal,
                    modelId: resolved.modelId,
                    thinking: req.thinkingMode === true,
                    ...(req.abortSignal ? { abortSignal: req.abortSignal } : {}),
                },
                {
                    onToken: (token) => onToken(token, undefined),
                    onThinking: (thinking) => onToken('', thinking),
                    onUsage: (usage) => {
                        deps.onUsage?.(usage);
                        inputTokensTotal += usage.prompt_tokens ?? 0;
                        outputTokensTotal += usage.completion_tokens ?? 0;
                        if (usage.cost_usd_micros !== undefined) {
                            directCostUsdMicrosTotal = (directCostUsdMicrosTotal ?? 0) + usage.cost_usd_micros;
                        }
                    },
                },
            );
        }
    } catch (err) {
        errorCode = err && typeof err === 'object' && 'code' in err
            ? String((err as { code: unknown }).code)
            : 'UPSTREAM_ERROR';
        // 접근 불가 판정 자동 학습 — provider 카탈로그에는 있으나 이 계정으로는 못 쓰는
        // 모델(Ollama Cloud 구독 전용 403, NVIDIA 계정별 404 등)을 목록에서 걸러내기 위해
        // 실패를 영속화한다. fire-and-forget — 기록 실패가 채팅 오류를 덮지 않는다.
        markModelUnusableFireAndForget(deps, req.userId, resolved, errorCode, err);
        recordExternalUsageFireAndForget(deps, {
            userId: req.userId,
            resolved,
            inputTokens: inputTokensTotal,
            outputTokens: outputTokensTotal,
            durationMs: Date.now() - startedAt,
            errorCode,
            ...(directCostUsdMicrosTotal !== undefined ? { directCostUsdMicros: directCostUsdMicrosTotal } : {}),
        });
        throw err;
    }

    logger.info(
        `외부 provider 호출 완료: ${resolved.fullId} ` +
        `(in=${inputTokensTotal}, out=${outputTokensTotal}, tools=${tools.length})`,
    );

    recordExternalUsageFireAndForget(deps, {
        userId: req.userId,
        resolved,
        inputTokens: inputTokensTotal,
        outputTokens: outputTokensTotal,
        durationMs: Date.now() - startedAt,
        finishReason: result.finishReason,
        ...(directCostUsdMicrosTotal !== undefined ? { directCostUsdMicros: directCostUsdMicrosTotal } : {}),
    });

    // 도구 루프 중 수집한 블록(생성 이미지·카카오 지도·토론 출처·웹검색 출처·보고서)을 최종
    // 응답에 결정적으로 첨부 — 상세는 external-deterministic-append (LLM 의 도구/인용 지시 누락 보정).
    const finalContent = appendDeterministicBlocks({
        finalContent: result.content || '',
        onToken,
        generatedImageMarkdowns,
        kakaomapBlocks,
        discussionSourceBlocks,
        odArtifact,
        req,
        ctx,
    });

    return finalContent;
}

// 도구 실행·사용량 기록은 external-tool-exec.ts 로 분리(600줄 CI 가드) — 기존 import 경로 호환 재노출.
export { executeExternalTool, recordExternalUsageFireAndForget };
