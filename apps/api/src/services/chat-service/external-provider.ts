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
import { SPAWN_AGENTS_TOOL_NAME } from '../agent-spawn/spawn-agents';
import { LOOP_DETECTION, AGENT_LOOP_LIMITS, MAP_INTENT_PATTERNS, SPAWN_INTENT_PATTERNS, EXTERNAL_LLM_INPUT_TOKEN_BUDGET } from '../../config/runtime-limits';
import { estimateMessageTokens, truncateMessagesPreservingSystem } from '../../llm/model-pool';
import { AGENT_SPAWN } from '../../config/runtime-limits';
import { buildExternalToolPlan, detectOrchestrationIntents } from './external-tool-plan';
import { buildExternalMessages } from './external-messages';
import { createToolBatchState, runToolCallBatch } from './external-tool-batch';
import { applyWallClockGuard, applyToolOveruseGuard } from './external-loop-guards';
import { isOrchestrationTool } from './orchestration-dispatch';
import type { ChatMessageRequest } from '../chat-service-types';
import type { ResolvedProvider } from '../../providers/provider-router';

import { executeExternalTool, recordExternalUsageFireAndForget } from './external-tool-exec';

import { resolveModelCapabilities } from './model-capabilities';
import { markModelUnusableFireAndForget } from './external-model-availability';
import { appendDeterministicBlocks } from './external-deterministic-append';

const logger = createLogger('ChatExternalProvider');

// 공개 타입은 external-provider-types 로 분리(600줄 CI 가드) — 기존 import 경로 호환 재노출.
export type { ExternalProviderDeps, ChatTimings, StreamFromExternalContext } from './external-provider-types';
import type { ExternalProviderDeps, ChatTimings, StreamFromExternalContext } from './external-provider-types';


/**
 * 외부 LLM provider stream + multi-turn tool calling.
 */
/**
 * thinking 옵션 결정 — 토글이 켜져 있으면 사용자가 고른 추론 강도를 그대로 넘긴다.
 * 강도 미지정(구 클라이언트)은 `true` 로 기존 동작을 유지하며, 모델이 받지 않는 값은
 * config/reasoning-effort 가 정규화한다.
 */
function resolveThinking(
    req: { thinkingMode?: boolean; thinkingLevel?: 'low' | 'medium' | 'high' },
    supportsThinking: boolean,
): boolean | 'low' | 'medium' | 'high' {
    if (req.thinkingMode !== true) return false;
    // 모델이 thinking 을 지원하지 않으면 요청하지 않는다. vision·tools 와 달리 차단이 아니라
    // 조용한 degrade — 다만 이유는 로그로 남긴다.
    //
    // 왜 필요한가: enable_thinking=true 를 보내면 stream-parser 가 스트림 **시작부터** reasoning
    // 으로 간주하고 `</think>` 경계를 기다린다(chat_template 이 여는 태그를 prepend 하는 모델
    // 규약). 그 태그를 쓰지 않는 모델이면 답변 전체가 thinking 채널로 흘러들어가 접힌 영역에
    // 그려지다가 종료 시 recovery 로 승격된다 — 죽지는 않지만 스트리밍 UX 가 무너진다.
    if (!supportsThinking) return false;
    return req.thinkingLevel ?? true;
}

export async function runExternalStream(
    deps: ExternalProviderDeps,
    resolved: ResolvedProvider,
    req: ChatMessageRequest,
    onToken: (token: string, thinking?: string) => void,
    ctx: StreamFromExternalContext = {},
): Promise<string> {
    // TTFT 분해 계측 기준점 — 이 뒤로 프롬프트 조립·도구 계획이 진행된다.
    const enteredAtMs = Date.now();
    // 위치/지도 의도면 카카오 도구 우선 라우팅 — 시스템 프롬프트 넛지 + 도구 강제 주입에 함께 쓰인다.
    const wantsMap = MAP_INTENT_PATTERNS.some((re) => re.test(req.message ?? ''));
    // 오케스트레이션 자동 배정 의도 — 프롬프트 가이드 주입(아래)과 도구 노출(플랜)이 공유.
    const orchestration = detectOrchestrationIntents(req.message);
    // 병렬 위임 의도 — 매칭 턴에만 spawn_agents 사용 가이드를 주입한다 (도구는 상시 노출이나
    // description 의 보수적 경고 탓에 자발 채택이 0 이던 갭 보완).
    const wantsSpawn = AGENT_SPAWN.ENABLED
        && SPAWN_INTENT_PATTERNS.some((re) => re.test(req.message ?? ''));

    // 메시지 배열 조립(시스템 프롬프트 + history + 현재 turn)은 external-messages 로 분리.
    const messages = buildExternalMessages({ req, resolved, ctx, wantsMap, orchestration, wantsSpawn });


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
    // 사용자가 thinking 을 켰는데 모델이 미지원이면 요청당 1회 고지(조용한 축소 방지).
    if (req.thinkingMode === true && !caps.thinking) {
        logger.warn(
            `[Thinking] '${resolved.fullId}' 는 thinking 미지원(capabilities.thinking=false, source=${capsSource}) — ` +
            '이번 요청은 추론 없이 처리합니다. 지원 모델이면 LLM_MODEL_CAPABILITIES_JSON 으로 켜세요.',
        );
    }

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
    // 병렬 위임(spawn) 의도 턴도 적재 — 노출→채택률을 재야 설명문·가이드 조정의 효과를 안다(110).
    if (orchestration.discussion || orchestration.taskDelegate || wantsSpawn) {
        ctx.orchestrationTelemetry = {
            discussionIntent: orchestration.discussion,
            taskDelegateIntent: orchestration.taskDelegate,
            spawnIntent: wantsSpawn,
            exposed: tools
                .filter((t) => isOrchestrationTool(t.function.name) || t.function.name === SPAWN_AGENTS_TOOL_NAME)
                .map((t) => t.function.name),
        };
    }

    const startedAt = Date.now();
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
    // 도구 배치가 누적하는 값(이미지 생성 소요시간·호출 집계·결정적 첨부 블록)은
    // external-tool-batch 가 소유한다 — 각 필드의 의미는 그 모듈의 ToolBatchState 참고.
    const state = createToolBatchState();


    try {
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
            // Wall-clock 예산 가드(이미지 생성 소요시간 공제) — 상세는 external-loop-guards.
            if (!suppressTools && applyWallClockGuard({ startedAt, imageGenCreditMs: state.imageGenCreditMs, messages })) {
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
                    thinking: resolveThinking(req, caps.thinking),
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
            // 도구 호출 배치 실행(이미지 병렬 선실행 · 위임/오케스트레이션 분기와 호출 캡 ·
            // 결정적 첨부 블록 수집)은 external-tool-batch 로 분리.
            await runToolCallBatch({
                deps, req, ctx, tools, messages, toolCalls: result.toolCalls, state,
            });

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
                    thinking: resolveThinking(req, caps.thinking),
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
        generatedImageMarkdowns: state.generatedImageMarkdowns,
        kakaomapBlocks: state.kakaomapBlocks,
        discussionSourceBlocks: state.discussionSourceBlocks,
        odArtifact: state.odArtifact,
        req,
        ctx,
    });

    return finalContent;
}

// 도구 실행·사용량 기록은 external-tool-exec.ts 로 분리(600줄 CI 가드) — 기존 import 경로 호환 재노출.
export { executeExternalTool, recordExternalUsageFireAndForget };
