/**
 * ============================================================
 * External Tool Exec — 외부 LLM tool calling 실행 + 사용량 기록
 * ============================================================
 *
 * external-provider.ts 에서 분리(600줄 CI 가드): 도구 루프 본체
 * (streamFromExternalProvider)와 독립적인 실행 유닛 2종.
 * - executeExternalTool: MCP 도구 실행 + user sandbox + 콜백 통지
 * - recordExternalUsageFireAndForget: 외부 provider 사용량 비차단 기록
 *
 * @module services/chat-service/external-tool-exec
 */
import { createLogger } from '../../utils/logger';
import { MAX_TOOL_RESULT_CHARS } from '../../config/runtime-limits';
import { getUnifiedMCPClient } from '../../mcp/unified-client';
import { isPersistableUserId } from '../../utils/user-id-validation';
import type { ResolvedProvider } from '../../providers/provider-router';
import type { ExternalProviderDeps } from './external-provider';

const logger = createLogger('ChatExternalProvider');

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
