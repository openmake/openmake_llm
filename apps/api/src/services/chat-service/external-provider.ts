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
import { EXTERNAL_LLM_TOOL_BLACKLIST, LOOP_DETECTION, AGENT_LOOP_LIMITS, MAX_TOOL_RESULT_CHARS, ARTIFACT_REQUEST_SUPPRESSED_TOOLS, ARTIFACT_INTENT_PATTERNS, MAP_INTENT_PATTERNS, ROUTE_INTENT_PATTERNS, EXTERNAL_LLM_INPUT_TOKEN_BUDGET } from '../../config/runtime-limits';
import { estimateMessageTokens, truncateMessagesPreservingSystem } from '../../llm/model-pool';
import { getUnifiedMCPClient } from '../../mcp/unified-client';
import { isPersistableUserId } from '../../utils/user-id-validation';
import { type Style } from '../../chat/style';
import { buildExternalSystemPrompt } from './external-system-prompt';
import { CHAT_DELEGATE_TOOL_NAME, buildChatDelegateTool, runChatDelegate } from './chat-delegate';
import { SPAWN_AGENTS_TOOL_NAME, buildSpawnAgentsTool, runChatSpawnAgents } from '../agent-spawn/spawn-agents';
import { CHAT_SUBAGENT, AGENT_SPAWN } from '../../config/runtime-limits';
import type { ChatMessage, ToolDefinition } from '../../llm';
import type { ChatMessageRequest } from '../chat-service-types';
import type { UserContext } from '../../mcp/user-sandbox';
import type { ResolvedProvider } from '../../providers/provider-router';
import type { ProviderRouter } from '../../providers/provider-router';
import { WEB_SEARCH_TEMPLATES, getLocalizedTemplate } from '../../sockets/ws-chat-locales';

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
    /** Allowed tools (agent 매칭 후) */
    allowedTools: ToolDefinition[];
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
}

/**
 * 외부 LLM provider stream + multi-turn tool calling.
 */
export async function streamFromExternalProvider(
    deps: ExternalProviderDeps,
    resolved: ResolvedProvider,
    req: ChatMessageRequest,
    onToken: (token: string, thinking?: string) => void,
    ctx: StreamFromExternalContext = {},
): Promise<string> {
    const messages: ChatMessage[] = [];

    // 위치/지도 의도면 카카오 도구 우선 라우팅 — 시스템 프롬프트 넛지 + 도구 강제 주입에 함께 쓰인다.
    const wantsMap = MAP_INTENT_PATTERNS.some((re) => re.test(req.message ?? ''));

    // 시스템 프롬프트 조립(정적 헌법 → DYNAMIC → 가변)은 external-system-prompt 로 분리.
    const systemContent = buildExternalSystemPrompt({ req, resolved, ctx, wantsMap });
    if (systemContent) {
        messages.push({ role: 'system', content: systemContent });
    }

    for (const h of req.history ?? []) {
        // history 에 섞인 system 메시지는 제외한다. external-provider 는 위(151)에서 자체
        // system 을 맨 앞에 조립하므로, history 의 system 을 그대로 두면 두 번째 system 이
        // 중간 위치에 들어가 vLLM/qwen 템플릿이 "System message must be at the beginning"
        // (400 BadRequest) 으로 거부한다.
        if (h.role === 'system') continue;
        const role = h.role === 'user' || h.role === 'assistant'
            ? h.role
            : 'user';
        messages.push({
            role,
            content: h.content,
            ...(h.images ? { images: h.images } : {}),
        });
    }

    messages.push({
        role: 'user',
        content: ctx.enhancedMessage || req.message,
        ...(req.images ? { images: req.images } : {}),
    });

    const caps = resolved.provider.getCapabilities(resolved.modelId);

    const hasImages = (req.images && req.images.length > 0)
        || (req.history ?? []).some((h) => h.images && h.images.length > 0);
    if (hasImages && !caps.vision) {
        const err = new Error(
            `Model '${resolved.fullId}' does not support vision input (capabilities.vision=false). ` +
            'Use a vision-capable model or remove images from the request.',
        );
        (err as Error & { statusCode?: number }).statusCode = 400;
        throw err;
    }

    // 명시적 아티팩트 생성 요청(사용자 아티팩트 토글 또는 메시지 패턴)이면 distractor
    // always-on 도구(generate_image 등)를 제외해 모델이 도구 호출 대신 <artifact> 산출물을
    // 쓰도록 유도 (2026-06-23 통제실험 근거).
    const wantsArtifact = req.artifactMode === true
        || ARTIFACT_INTENT_PATTERNS.some((re) => re.test(req.message ?? ''));
    // 위치/지도 의도(wantsMap, 위에서 계산)면 generate_image 를 제외 — 모델이 가짜 지도
    // 이미지를 그리는 대신 카카오 검색 + 네이티브 지도 블록을 쓰도록 유도 (distractor 억제).
    const tools = caps.toolCalling
        ? deps.allowedTools.filter((t) =>
            !EXTERNAL_LLM_TOOL_BLACKLIST.includes(t.function.name)
            && !(wantsArtifact && ARTIFACT_REQUEST_SUPPRESSED_TOOLS.includes(t.function.name))
            && !(wantsMap && t.function.name === 'generate_image'))
        : [];
    // 채팅 서브에이전트(chat-delegate): 전문가 위임 도구 노출 — 스키마 +1 은 문법 컴파일 무해.
    if (CHAT_SUBAGENT.ENABLED && caps.toolCalling) {
        tools.push(buildChatDelegateTool());
    }
    // 병렬 서브에이전트 fan-out(spawn_agents): 독립 하위 작업 N개 병렬 위임 — agent-spawn 공용 모듈.
    if (AGENT_SPAWN.ENABLED && caps.toolCalling) {
        tools.push(buildSpawnAgentsTool());
    }
    if (wantsArtifact && caps.toolCalling) {
        logger.info(`[Artifact] 명시적 아티팩트 요청 감지 — distractor 도구 억제 (잔여 도구 ${tools.length}종)`);
    }
    if (wantsMap && caps.toolCalling) {
        logger.info(`[Map] 위치/지도 의도 감지 — generate_image 억제 (잔여 도구 ${tools.length}종)`);
    }
    // 지도/길찾기 의도 시 첫 턴에 카카오 도구를 강제 호출(tool_choice)한다. 길찾기면 find-route,
    // 그 외 지도면 search-places. 넛지만으론 qwen 이 web_search/자체아티팩트로 이탈 → 강제로
    // 블록 확보 후 결정적 주입.
    const routeIntent = ROUTE_INTENT_PATTERNS.some((re) => re.test(req.message ?? ''));
    const forcedKakaoToolName = caps.toolCalling
        ? (routeIntent
            ? tools.find((t) => t.function.name.includes('find-route'))?.function.name
            : (wantsMap ? tools.find((t) => t.function.name.includes('search-places'))?.function.name : undefined))
        : undefined;
    if (forcedKakaoToolName) {
        logger.info(`[Map] 첫 턴 tool_choice 강제: ${forcedKakaoToolName}`);
    }

    const startedAt = Date.now();
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
    // 채팅 서브에이전트 호출 집계 — 메시지당 캡(CHAT_SUBAGENT.MAX_CALLS) 초과 시 위임 거부.
    let delegateCalls = 0;
    // 병렬 fan-out 호출 집계 — 메시지당 캡(AGENT_SPAWN.MAX_CALLS_PER_MESSAGE) 초과 시 거부.
    let spawnCalls = 0;

    // generate_image 결과의 이미지 마크다운 추적 — 일부 모델(qwen 등)이 도구 지시("마크다운
    // 그대로 포함")를 누락해 생성된 이미지가 채팅에 표시되지 않는 문제 보정용.
    // 루프 종료 후 최종 응답에 누락돼 있으면 결정적으로 첨부한다.
    const generatedImageMarkdowns: string[] = [];
    // 카카오 지도: search-places 도구 결과가 동봉하는 ```kakaomap 블록을 수집한다.
    // 로컬 모델(qwen)이 블록을 답변에 옮기지 않고 요약해버려 지도가 안 뜨는 문제를
    // 위 generate_image 와 동일하게 결정적 첨부로 보정한다.
    const kakaomapBlocks: string[] = [];

    try {
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
            // Wall-clock 예산 가드 — 턴 수와 별개로 누적 시간 초과 시 도구 끄고 최종 응답 유도
            if (!suppressTools && AGENT_LOOP_LIMITS.MAX_WALL_CLOCK_MS > 0
                && Date.now() - startedAt > AGENT_LOOP_LIMITS.MAX_WALL_CLOCK_MS) {
                logger.warn(`⏱️ 외부 LLM 루프 wall-clock 예산 초과 (${AGENT_LOOP_LIMITS.MAX_WALL_CLOCK_MS}ms) — 도구 비활성 최종 턴으로 전환`);
                suppressTools = true;
                messages.push({
                    role: 'user',
                    content: '처리 시간이 초과되었습니다. 추가 도구 호출 없이 현재까지 수집한 정보로 답변을 완성하세요.',
                });
            }
            const turnTools = suppressTools ? [] : tools;
            // A. context-fit 안전망: external 경로는 LLMClient.chat 의 model-pool truncate 를
            // 우회하므로, 도구 루프로 누적된 messages 가 예산을 넘으면 system 보존 + 최근 우선
            // 으로 절단한다(큰 컨텍스트가 그대로 전달돼 모델이 빈 응답을 내는 회귀의 극단 방어).
            const fittedMessages = estimateMessageTokens(messages) > EXTERNAL_LLM_INPUT_TOKEN_BUDGET
                ? truncateMessagesPreservingSystem(messages, EXTERNAL_LLM_INPUT_TOKEN_BUDGET)
                : messages;
            result = await resolved.provider.streamChat(
                {
                    messages: fittedMessages,
                    modelId: resolved.modelId,
                    thinking: req.thinkingMode === true,
                    ...(turnTools.length > 0 ? { tools: turnTools } : {}),
                    // 첫 턴만 카카오 도구 강제 — 이후 턴은 auto(모델이 결과로 답변 작성).
                    ...(turn === 0 && forcedKakaoToolName && turnTools.length > 0
                        ? { tool_choice: { type: 'function' as const, function: { name: forcedKakaoToolName } } }
                        : {}),
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
                } else {
                    toolResult = await executeExternalTool(deps, tc.name, tc.args as Record<string, unknown>);
                }
                if (tc.name === 'generate_image') {
                    const m = toolResult.match(/!\[[^\]]*\]\(\/generated\/[^)]+\)/);
                    if (m && !generatedImageMarkdowns.includes(m[0])) {
                        generatedImageMarkdowns.push(m[0]);
                    }
                }
                // 카카오 지도 블록 수집(도구명 무관 — 도구 결과에 블록이 있으면).
                for (const mm of toolResult.matchAll(/```kakaomap\s*\n[\s\S]*?```/g)) {
                    if (!kakaomapBlocks.includes(mm[0])) kakaomapBlocks.push(mm[0]);
                }
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
        }
        if (!result) throw new Error('streamChat 호출 결과 없음');
    } catch (err) {
        errorCode = err && typeof err === 'object' && 'code' in err
            ? String((err as { code: unknown }).code)
            : 'UPSTREAM_ERROR';
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

    // generate_image 가 성공했으나 LLM 이 최종 응답에 이미지 마크다운을 누락한 경우 결정적 첨부.
    // (qwen 등 로컬 모델이 도구 지시를 따르지 않아 생성 이미지가 채팅에 표시 안 되던 문제 보정.
    //  onToken = 라이브 스트림, 반환값 = 저장 히스토리 — 양쪽에 반영해 reload 후에도 유지.)
    let finalContent = result.content || '';
    const missingImages = generatedImageMarkdowns.filter((md) => {
        const pathMatch = md.match(/\(([^)]+)\)/);
        return !pathMatch || !finalContent.includes(pathMatch[1]);
    });
    if (missingImages.length > 0) {
        const appended = (finalContent.trim() ? '\n\n' : '') + missingImages.join('\n\n');
        onToken(appended, undefined);
        finalContent += appended;
        logger.info(`🖼️ 생성 이미지 ${missingImages.length}개 자동 첨부 (LLM 응답 누락 보정)`);
    }

    // 카카오 지도 블록도 동일하게 — LLM 이 옮기지 않았으면 결정적 첨부(라이브 stream + 저장 히스토리).
    const missingMaps = kakaomapBlocks.filter((b) => !finalContent.includes(b));
    if (missingMaps.length > 0) {
        const appended = (finalContent.trim() ? '\n\n' : '') + missingMaps.join('\n\n');
        onToken(appended, undefined);
        finalContent += appended;
        logger.info(`🗺️ 카카오 지도 블록 ${missingMaps.length}개 자동 첨부 (LLM 응답 누락 보정)`);
    }

    // 웹검색 출처 목록 결정적 첨부 — LLM(qwen)이 프롬프트의 인용 지시를 자주 무시해 근거 소스가
    // 답변에 안 드러나던 문제 보정. req.webSearchContext(formatSearchSources 포맷)에서 제목·URL 을
    // 파싱해 응답 끝에 출처 목록을 붙인다(카카오맵 블록과 동일한 결정적 첨부 패턴, 라이브 stream +
    // 저장 히스토리 양쪽 반영). 모델이 이미 출처 섹션(헤더)을 만든 경우엔 중복 방지로 skip.
    // 소스 문자열은 message-pipeline 경로에선 req.webSearchContext 가 아니라 ctx.enhancedMessage
    // (finalEnhancedMessage, context-builder 가 웹검색 컨텍스트를 합친 값)에 실려 온다. 둘 다 fallback.
    const webSearchCtxText = req.webSearchContext || ctx.enhancedMessage || '';
    if (/\[[^\]]*?\d+\]\s*.+?\n\s*URL:\s*\S+/.test(webSearchCtxText)) {
        const srcLang = ctx.resolvedLanguage || req.userLanguagePreference || 'en';
        const srcLabel = getLocalizedTemplate(WEB_SEARCH_TEMPLATES, srcLang).sourceLabel;
        const alreadyHasSources = new RegExp(`(^|\\n)\\s*(#{1,3}\\s*|\\*\\*\\s*)${srcLabel}`).test(finalContent);
        if (!alreadyHasSources) {
            const entries: string[] = [];
            const seen = new Set<string>();
            const re = /\[[^\]]*?(\d+)\]\s*(.+?)\n\s*URL:\s*(\S+)/g;
            let mm: RegExpExecArray | null;
            while ((mm = re.exec(webSearchCtxText)) !== null) {
                const title = mm[2].trim();
                const url = mm[3].trim();
                if (url && !seen.has(url)) {
                    seen.add(url);
                    entries.push(`${entries.length + 1}. [${title || url}](${url})`);
                }
            }
            if (entries.length > 0) {
                const block = `\n\n---\n\n**${srcLabel}**\n${entries.join('\n')}`;
                onToken(block, undefined);
                finalContent += block;
                logger.info(`🔗 웹검색 출처 ${entries.length}개 자동 첨부 (LLM 인용 누락 보정)`);
            }
        }
    }

    return finalContent;
}

/**
 * 외부 LLM Tool Calling — MCP 도구 실행 + user sandbox.
 */
export async function executeExternalTool(
    deps: ExternalProviderDeps,
    toolName: string,
    toolArgs: Record<string, unknown>,
): Promise<string> {
    try {
        const mcpClient = getUnifiedMCPClient();
        const userCtx = deps.currentUserContext || {
            userId: 'guest',
            role: 'guest' as const,
        };
        // 도구 실행 시작 알림 — 권한 체크 통과 후, 실제 호출 직전.
        // frontend 가 "🔍 {도구} 실행 중" 진행 표시로 "생각 중..." 멈춤 혼선 해소.
        if (deps.mcpToolStartCallback) {
            try { deps.mcpToolStartCallback({ toolName }); }
            catch (e) { logger.warn(`onMcpToolStart 콜백 실패: ${e instanceof Error ? e.message : String(e)}`); }
        }

        const result = await mcpClient.executeToolWithContext(toolName, toolArgs, userCtx);

        if (deps.mcpToolResultCallback && Array.isArray(result.content)) {
            const resources = result.content
                .filter((c): c is { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string } } =>
                    c.type === 'resource' && !!c.resource && typeof c.resource.uri === 'string')
                .map(c => ({ uri: c.resource.uri, mimeType: c.resource.mimeType, text: c.resource.text }));
            if (resources.length > 0) {
                try { deps.mcpToolResultCallback({ toolName, resources }); }
                catch (e) { logger.warn(`onMcpToolResult 콜백 실패: ${e instanceof Error ? e.message : String(e)}`); }
            }
        }

        if (result.isError) {
            return `Error: ${typeof result.content === 'string' ? result.content : JSON.stringify(result.content)}`;
        }
        if (typeof result.content === 'string') return result.content;
        // 카카오 지도 블록은 8000자 캡(slice)·JSON.stringify 이스케이프에 소실되지 않도록
        // 원본 텍스트에서 추출해 반환 문자열 앞에 실제 개행으로 prepend 한다.
        // (search-places 출력이 길어 블록이 끝에 있으면 캡에 잘리던 문제 — 호출부가 이 블록을 결정적 첨부)
        let mapPrefix = '';
        if (Array.isArray(result.content)) {
            const rawText = result.content
                .filter((c): c is { type: 'text'; text: string } =>
                    (c as { type?: unknown }).type === 'text' && typeof (c as { text?: unknown }).text === 'string')
                .map((c) => c.text)
                .join('\n');
            const m = rawText.match(/```kakaomap[\s\S]*?```/);
            if (m) mapPrefix = `${m[0]}\n\n`;
        }
        return mapPrefix + JSON.stringify(result.content).slice(0, MAX_TOOL_RESULT_CHARS);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`외부 LLM 도구 실행 실패 (${toolName}): ${msg}`);
        return `Error: ${msg}`;
    }
}

/**
 * 외부 provider 사용량 fire-and-forget 기록.
 * FK 가드: guest / anon-* / anonymous sentinel 은 users 테이블에 없어 FK 위반 — 비인증 사용자 skip.
 */
export function recordExternalUsageFireAndForget(
    deps: ExternalProviderDeps,
    input: {
        userId: string | undefined;
        resolved: ResolvedProvider;
        inputTokens: number;
        outputTokens: number;
        durationMs: number;
        finishReason?: string;
        errorCode?: string | null;
        directCostUsdMicros?: number;
    },
): void {
    if (!isPersistableUserId(input.userId) || !deps.providerRouter) return;
    const repo = deps.providerRouter.getExternalKeysRepo();
    if (!repo) return;
    const userId = input.userId;

    let costUsdMicros: number;
    if (input.directCostUsdMicros !== undefined && input.directCostUsdMicros >= 0) {
        costUsdMicros = input.directCostUsdMicros;
    } else {
        const { computeCostMicros } = require('../../config/external-pricing') as
            typeof import('../../config/external-pricing');
        costUsdMicros = computeCostMicros(
            input.resolved.providerId,
            input.resolved.modelId,
            input.inputTokens,
            input.outputTokens,
        );
    }

    repo.recordUsage({
        userId,
        providerId: input.resolved.providerId,
        modelId: input.resolved.modelId,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costUsdMicros,
        durationMs: input.durationMs,
        finishReason: input.finishReason,
        errorCode: input.errorCode ?? undefined,
    }).then(() => {
        return repo.touchLastUsed(userId, input.resolved.providerId);
    }).catch((err) => {
        logger.warn(`외부 사용량 기록 실패: ${err instanceof Error ? err.message : err}`);
    });
}
