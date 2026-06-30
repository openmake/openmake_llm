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
import { EXTERNAL_LLM_TOOL_BLACKLIST, LOOP_DETECTION, AGENT_LOOP_LIMITS, MAX_TOOL_RESULT_CHARS, ARTIFACT_REQUEST_SUPPRESSED_TOOLS, ARTIFACT_INTENT_PATTERNS, EXTERNAL_LLM_INPUT_TOKEN_BUDGET } from '../../config/runtime-limits';
import { estimateMessageTokens, truncateMessagesPreservingSystem } from '../../llm/model-pool';
import { getUnifiedMCPClient } from '../../mcp/unified-client';
import { isPersistableUserId } from '../../utils/user-id-validation';
import { getExternalProviderSystemGuards } from '../../chat/prompt';
import { getStyleGuard, normalizeStyle, type Style } from '../../chat/style';
import type { ChatMessage, ToolDefinition } from '../../llm';
import type { ChatMessageRequest } from '../chat-service-types';
import type { UserContext } from '../../mcp/user-sandbox';
import type { ResolvedProvider } from '../../providers/provider-router';
import type { ProviderRouter } from '../../providers/provider-router';

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
    const systemPromptParts: string[] = [];

    // ════════════════════════════════════════════════════════════════════
    // 정적 헌법 (CACHE PREFIX) — 모든 요청 공통이라 prefix caching hit 을 극대화한다.
    // 가변 데이터를 이 앞에 두면 prefix 가 매 요청 달라져 vLLM/OpenRouter 캐시가 무효화되므로,
    // 정적 콘텐츠(가드·아티팩트 가이드)를 반드시 시스템 프롬프트 맨 앞에 배치한다. (Cache-aware 원칙)
    // ════════════════════════════════════════════════════════════════════
    // Phase 2026-05-26: 외부 provider 도 Identity Guard + Response Discipline 적용.
    // 본 가드 미적용 시 Gemini/GPT 가 "Here's a thinking process", 단계 1-N,
    // 자기 정체 노출 같은 verbose 형식을 그대로 출력 (사용자 보고 사례 해결).
    // 응답 스타일 가드 (concise/verbose) — 정적 prefix 맨 앞에 prepend. default 면 빈 문자열(overhead 0).
    // strategy 경로의 applyStyle 과 동일 정책: 외부 provider 도 사용자 선택 스타일을 반영한다.
    const styleGuard = getStyleGuard(
        normalizeStyle(ctx.style),
        ctx.resolvedLanguage || req.userLanguagePreference || 'en',
    );
    if (styleGuard) {
        systemPromptParts.push(styleGuard.trim());
    }
    const guards = getExternalProviderSystemGuards(ctx.resolvedLanguage || req.userLanguagePreference || 'en');
    if (guards) {
        systemPromptParts.push(guards.trim());
    }
    // 답변 형식 가드 (구조적 질문) — 정적 prefix. prose/concise 면 빈 문자열이라 미주입.
    if (ctx.answerFormatBlock) {
        systemPromptParts.push(ctx.answerFormatBlock.trim());
    }
    // Artifacts guide (디자인시스템·<artifact> 형식) — 정적.
    if (ctx.artifactGuideBlock) {
        systemPromptParts.push(ctx.artifactGuideBlock.trim());
    }

    // ──────────────────── DYNAMIC BOUNDARY ────────────────────
    // 아래는 요청/사용자/세션별 가변 콘텐츠. prefix 캐시 보존을 위해 반드시 정적 헌법 뒤에 배치한다.
    // system 채널이라 위치가 뒤여도(최근일수록 attention↑) 사용자 맥락(memory/custom)의 우선순위는 유지된다.
    if (ctx.agentSystemMessage) {
        systemPromptParts.push(ctx.agentSystemMessage);
    }
    // Cross-conversation Memory + Custom Instructions (claude.ai Memory/Custom Instructions 동등).
    if (ctx.memoryBlock) {
        systemPromptParts.push(ctx.memoryBlock.trim());
    }
    if (ctx.customInstructionsBlock) {
        systemPromptParts.push(ctx.customInstructionsBlock.trim());
    }

    const langCode = ctx.resolvedLanguage || req.userLanguagePreference;
    if (langCode) {
        const langMap: Record<string, string> = {
            ko: '한국어', en: 'English', ja: '日本語', zh: '中文',
            es: 'Español', fr: 'Français', de: 'Deutsch',
        };
        const langName = langMap[langCode] || langCode;
        systemPromptParts.push(`Respond in ${langName}.`);
    }

    // 웹검색 컨텍스트가 있을 때 grounding + 반-환각 지시를 시스템 프롬프트에 보강한다.
    // enhancedMessage(user turn)에 검색 컨텍스트가 이미 포함된 경로(message-pipeline)에서는
    // 지시문만 추가해 중복 주입을 피하고, 직접 경로(enhancedMessage 미설정)에서는
    // 지시 + 컨텍스트를 함께 넣는다. fast 모드(thinking OFF) 모델이 주입 컨텍스트를
    // 무시하고 단정적 오답을 내는 것을 완화 — 최신 사실이 검색 결과에 없으면 추측 대신
    // 불확실성을 인정하도록 유도 (system 채널이라 응답 절제 가드보다 우선 적용).
    if (req.webSearchContext) {
        const groundingDirective =
            '제공된 웹 검색 결과를 최우선 근거로 삼아 정확히 답변하세요. 검색 결과에 없는 사실' +
            '(특히 최신 인물·직위·날짜 등 시의성 정보)은 추측하지 말고, 확인되지 않으면 모른다고 답하세요.';
        systemPromptParts.push(
            ctx.enhancedMessage
                ? groundingDirective
                : `${groundingDirective}\n\n${req.webSearchContext}`,
        );
    }

    systemPromptParts.push(
        `[현재 사용 중인 모델: ${resolved.fullId}] ` +
        `사용자가 모델/provider 정보를 묻는 경우 위 식별자를 그대로 알려주세요.`,
    );

    if (systemPromptParts.length > 0) {
        messages.push({ role: 'system', content: systemPromptParts.join('\n\n') });
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
    const tools = caps.toolCalling
        ? deps.allowedTools.filter((t) =>
            !EXTERNAL_LLM_TOOL_BLACKLIST.includes(t.function.name)
            && !(wantsArtifact && ARTIFACT_REQUEST_SUPPRESSED_TOOLS.includes(t.function.name)))
        : [];
    if (wantsArtifact && caps.toolCalling) {
        logger.info(`[Artifact] 명시적 아티팩트 요청 감지 — distractor 도구 억제 (잔여 도구 ${tools.length}종)`);
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

    // generate_image 결과의 이미지 마크다운 추적 — 일부 모델(qwen 등)이 도구 지시("마크다운
    // 그대로 포함")를 누락해 생성된 이미지가 채팅에 표시되지 않는 문제 보정용.
    // 루프 종료 후 최종 응답에 누락돼 있으면 결정적으로 첨부한다.
    const generatedImageMarkdowns: string[] = [];

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
                    ...(req.abortSignal ? { abortSignal: req.abortSignal } : {}),
                },
                {
                    onToken: (token) => onToken(token, undefined),
                    onThinking: (thinking) => onToken('', thinking),
                    onUsage: (usage) => {
                        deps.onUsage?.(usage);
                        inputTokensTotal += usage.prompt_eval_count ?? 0;
                        outputTokensTotal += usage.eval_count ?? 0;
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
                const toolResult = await executeExternalTool(deps, tc.name, tc.args as Record<string, unknown>);
                if (tc.name === 'generate_image') {
                    const m = toolResult.match(/!\[[^\]]*\]\(\/generated\/[^)]+\)/);
                    if (m && !generatedImageMarkdowns.includes(m[0])) {
                        generatedImageMarkdowns.push(m[0]);
                    }
                }
                messages.push({
                    role: 'tool',
                    content: toolResult,
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
        return JSON.stringify(result.content).slice(0, MAX_TOOL_RESULT_CHARS);
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
