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
import { EXTERNAL_LLM_TOOL_BLACKLIST } from '../../config/runtime-limits';
import { getUnifiedMCPClient } from '../../mcp/unified-client';
import { isPersistableUserId } from '../../utils/user-id-validation';
import { getExternalProviderSystemGuards } from '../../chat/prompt';
import type { ChatMessage, ToolDefinition } from '../../llm';
import type { ChatMessageRequest } from '../chat-service-types';
import type { UserContext } from '../../mcp/user-sandbox';
import type { ResolvedProvider } from '../../providers/provider-router';
import type { ProviderRouter } from '../../providers/provider-router';

const logger = createLogger('ChatExternalProvider');

export interface ExternalProviderDeps {
    /** Provider router — `getExternalKeysRepo()` 등 사용 */
    providerRouter?: ProviderRouter;
    /** 현재 사용자 컨텍스트 — MCP tool tier 검사에 사용 */
    currentUserContext: UserContext | null;
    /** MCP tool 호출 결과 inline 카드 콜백 (frontend 표시용) */
    mcpToolResultCallback?: (data: { toolName: string; resources: Array<{ uri: string; mimeType?: string; text?: string }> }) => void;
    /** Provider usage 누적 — ChatService.lastProviderUsage setter */
    onUsage?: (usage: import('../../llm').UsageMetrics) => void;
    /** Allowed tools (tier + agent 매칭 후) */
    allowedTools: ToolDefinition[];
}

export interface StreamFromExternalContext {
    agentSystemMessage?: string;
    enhancedMessage?: string;
    resolvedLanguage?: string;
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

    // Phase 2026-05-26: 외부 provider 도 Identity Guard + Response Discipline 적용.
    // 본 가드 미적용 시 Gemini/GPT 가 "Here's a thinking process", 단계 1-N,
    // 자기 정체 노출 같은 verbose 형식을 그대로 출력 (사용자 보고 사례 해결).
    const guards = getExternalProviderSystemGuards(ctx.resolvedLanguage || req.userLanguagePreference || 'en');
    if (guards) {
        systemPromptParts.push(guards.trim());
    }

    if (ctx.agentSystemMessage) {
        systemPromptParts.push(ctx.agentSystemMessage);
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
        const role = h.role === 'user' || h.role === 'assistant' || h.role === 'system'
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

    const tools = caps.toolCalling
        ? deps.allowedTools.filter((t) => !EXTERNAL_LLM_TOOL_BLACKLIST.includes(t.function.name))
        : [];

    const startedAt = Date.now();
    let errorCode: string | null = null;
    let result: import('../../providers/i-provider').ChatStreamResult | undefined;
    let inputTokensTotal = 0;
    let outputTokensTotal = 0;
    let directCostUsdMicrosTotal: number | undefined;
    const MAX_TOOL_TURNS = 5;

    try {
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
            result = await resolved.provider.streamChat(
                {
                    messages,
                    modelId: resolved.modelId,
                    thinking: req.thinkingMode === true,
                    ...(tools.length > 0 ? { tools } : {}),
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

            if (!result.toolCalls || result.toolCalls.length === 0) {
                break;
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

    return result.content;
}

/**
 * 외부 LLM Tool Calling — MCP 도구 실행 + user sandbox + tier 권한 체크.
 */
export async function executeExternalTool(
    deps: ExternalProviderDeps,
    toolName: string,
    toolArgs: Record<string, unknown>,
): Promise<string> {
    try {
        if (deps.currentUserContext) {
            const { canUseTool } = await import('../../mcp/tool-tiers');
            if (!canUseTool(deps.currentUserContext.tier, toolName)) {
                return `🔒 권한 없음: "${toolName}" 도구는 ${deps.currentUserContext.tier} 등급에서 사용 불가`;
            }
        }

        const mcpClient = getUnifiedMCPClient();
        const userCtx = deps.currentUserContext || {
            userId: 'guest',
            tier: 'free' as const,
            role: 'guest' as const,
        };
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
        return JSON.stringify(result.content).slice(0, 8000);
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
