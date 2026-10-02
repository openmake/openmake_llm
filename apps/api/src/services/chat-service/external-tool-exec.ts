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
import { getChatTurnIntegrations } from './turn-integrations';
import { recordLlmCost } from '../cost/cost-ledger-service';
import { MAX_TOOL_RESULT_CHARS, CHAT_TOOL_CARD } from '../../config/runtime-limits';
import { prepareToolArgs } from '../agent-task/tool-args';
import { recordToolResultTruncation } from '../tool-result-truncation-recorder';
import { getToolRuntime } from '../../runtime-ports/tool-runtime';
import { isPersistableUserId } from '../../utils/user-id-validation';
import type { ResolvedProvider } from '../../providers/provider-router';
import type { ExternalProviderDeps } from './external-provider-types';

const logger = createLogger('ChatExternalProvider');

type ToolResources = Array<{ uri: string; mimeType?: string; text?: string }>;
interface ToolSideOutput { resources: ToolResources; sources?: import('../../tools/web-search/types').SearchSourceRef[] }

/** PURE: 화면에 보낼 길이로 자른다 — 넘으면 말줄임표를 붙인다. */
function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * PURE: 도구 호출 한 번의 요약 — 채팅의 도구 카드가 보여 준다(성공·실패, 걸린 시간, 인자, 결과 앞부분).
 * 인자는 에이전트 작업과 같은 가림 규칙(prepareToolArgs)을 거친다. 결과 전문은 싣지 않는다.
 */
export function summarizeToolCall(toolArgs: Record<string, unknown>, resultText: string, durationMs: number): { ok: boolean; durationMs: number; args?: string; preview?: string } {
    const masked = prepareToolArgs(toolArgs);
    const args = masked === undefined ? undefined : clip(JSON.stringify(masked), CHAT_TOOL_CARD.ARGS_CHARS);
    const preview = resultText.trim() ? clip(resultText.trim(), CHAT_TOOL_CARD.PREVIEW_CHARS) : undefined;
    return { ok: !resultText.startsWith('Error:'), durationMs, ...(args ? { args } : {}), ...(preview ? { preview } : {}) };
}

/**
 * 외부 LLM Tool Calling — MCP 도구 실행 + user sandbox. 끝나면 결과 요약(+리소스·출처)을 콜백으로 한 번 알린다.
 */
export async function executeExternalTool(
    deps: ExternalProviderDeps,
    toolName: string,
    toolArgs: Record<string, unknown>,
): Promise<string> {
    const startedAt = Date.now();
    const side: ToolSideOutput = { resources: [] };
    const text = await runExternalTool(deps, toolName, toolArgs, side);
    if (deps.mcpToolResultCallback) {
        try {
            deps.mcpToolResultCallback({
                toolName, resources: side.resources, ...(side.sources ? { sources: side.sources } : {}),
                summary: summarizeToolCall(toolArgs, text, Date.now() - startedAt),
            });
        } catch (e) { logger.warn(`onMcpToolResult 콜백 실패: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return text;
}

/** 도구 실행 본체 — 결과를 LLM 컨텍스트 문자열로 돌려주고, 리소스·출처는 side 에 담는다. 절대 throw 하지 않는다. */
async function runExternalTool(
    deps: ExternalProviderDeps,
    toolName: string,
    toolArgs: Record<string, unknown>,
    side: ToolSideOutput,
): Promise<string> {
    try {
        const mcpClient = getToolRuntime();
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

        const result = await mcpClient.executeTool(toolName, toolArgs, userCtx);

        if (Array.isArray(result.content)) {
            side.resources = result.content
                .filter((c): c is { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string } } =>
                    c.type === 'resource' && !!c.resource && typeof c.resource.uri === 'string')
                .map(c => ({ uri: c.resource.uri, mimeType: c.resource.mimeType, text: c.resource.text }));
            // 웹검색류 도구의 구조화 출처(F19.4)도 같은 통로로 — 모델에게는 text 만 간다
            if (Array.isArray(result.sources) && result.sources.length > 0) side.sources = result.sources;
        }

        if (result.isError) {
            return `Error: ${typeof result.content === 'string' ? result.content : JSON.stringify(result.content)}`;
        }
        if (typeof result.content === 'string') {
            // 문자열 분기는 캡 미적용 — 분모 확보를 위해 동일하게 계측한다 (G3).
            const contentStr: string = result.content;
            recordToolResultTruncation({
                path: 'chat', toolName, rawChars: contentStr.length, capChars: MAX_TOOL_RESULT_CHARS,
            });
            return contentStr;
        }
        // 통합(add-on)이 지정한 블록은 길이 상한(slice)·JSON.stringify 이스케이프에 소실되지 않도록
        // 원본 텍스트에서 뽑아 반환 문자열 앞에 붙인다 — 호출부가 이 블록을 결정적으로 첨부한다.
        let preservedPrefix = '';
        if (Array.isArray(result.content)) {
            const rawText = result.content
                .filter((c): c is { type: 'text'; text: string } =>
                    (c as { type?: unknown }).type === 'text' && typeof (c as { text?: unknown }).text === 'string')
                .map((c) => c.text)
                .join('\n');
            for (const integration of getChatTurnIntegrations()) {
                preservedPrefix += integration.preserveFromRawResult?.(rawText) ?? '';
            }
        }
        // text 항목은 그대로 잇고 비텍스트(image·resource 등)만 JSON 으로 싣는다 — 에이전트 작업 경로
        // (task-sandbox resultToString)와 같은 방식. content 배열을 통째로 JSON.stringify 하면 줄바꿈·따옴표가
        // 이스케이프돼 길이가 늘고(open-design list_projects 7,765자 → 8,676자) 8000자 캡에 마지막 항목이
        // 잘렸다(2026-09-15). 모델도 이스케이프 없는 원문을 읽는다.
        const serialized = Array.isArray(result.content)
            ? result.content
                .map((c) => ((c as { type?: unknown }).type === 'text' && typeof (c as { text?: unknown }).text === 'string'
                    ? (c as { text: string }).text
                    : JSON.stringify(c)))
                .join('\n')
            : JSON.stringify(result.content);
        // G3 셰도우 계측 — 8000자 절단 발생률/폭 실측 (chunk-요약 도입 판단 게이트)
        recordToolResultTruncation({
            path: 'chat', toolName, rawChars: serialized.length, capChars: MAX_TOOL_RESULT_CHARS,
        });
        return preservedPrefix + serialized.slice(0, MAX_TOOL_RESULT_CHARS);
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

    // 비용 원장(F25) — external_provider_usage 와 병행 기록(원장이 단일 진실, 기존 표는 대시보드 호환)
    recordLlmCost({
        userId, model: input.resolved.fullId, external: true, costOwner: 'byok',
        promptTokens: input.inputTokens, completionTokens: input.outputTokens,
        directCostUsdMicros: input.directCostUsdMicros !== undefined && input.directCostUsdMicros >= 0 ? input.directCostUsdMicros : undefined,
        ctx: { feature: 'chat' },
    });
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
