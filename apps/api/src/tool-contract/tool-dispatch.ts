/**
 * 도구 실행 chokepoint — 내장 도구 실행과 **모든 도구에 공통인 거버넌스** (Add-on 전환 P2, 2026-09-19).
 *
 * 종전에는 MCP 런타임의 `ToolRouter.executeTool` 한 메서드 안에 내장/외부 두 갈래와 거버넌스가 함께 있었다.
 * MCP 런타임이 add-on 으로 나가면서, **Base 에 남아야 하는 것**(관측 span · 서킷 · 역할 게이트 · 정책 훅 ·
 * required 인자 검증 · 오류 분류/교정 힌트 · 출력 상한)을 여기로 뽑고, 외부 MCP 서버로의 라우팅만
 * add-on 이 `ExternalToolDispatch` 로 꽂는다. 내장 도구의 동작은 이동 전과 동일하다.
 *
 * ⚠️ 새 도구 실행 경로를 만들 때 이 함수를 우회하지 말 것 — 서킷·역할 게이트·훅·감사 분류가 전부 여기 있다
 * (노출 필터는 실행 게이트가 아니다, 2026-09-02 보안 리뷰).
 *
 * @module tool-contract/tool-dispatch
 */
import type { MCPToolResult, MCPToolDefinition, UserContext } from './types';
import { MCP_NAMESPACE_SEPARATOR } from './types';
import { isToolRestrictedForRole } from './tool-role-gate';
import { classifyToolError, formatToolError } from './tool-error-classifier';
import { withToolNameSuggestions } from './tool-name-suggest';
import { isToolCircuitOpen, recordToolResult } from './tool-health';
import { runPreHooks, runPostHooks, type ToolHookContext } from './tool-hooks';
import './default-hooks';
import { withSpan } from '../observability/otel';
import { createLogger } from '../utils/logger';
import { MCP_EXTERNAL_TOOL_LIMITS } from '../config/timeouts';

const logger = createLogger('ToolDispatch');

/**
 * 외부(`::` 네임스페이스) 도구 실행 위임 — MCP 런타임 add-on 이 구현한다.
 * 등록이 없으면 `::` 이름은 "도구를 찾을 수 없습니다" 로 떨어진다(= MCP add-on 이 꺼진 배포).
 */
export interface ExternalToolDispatch {
    /** 외부 도구를 실행한다. 이름을 모르면 `undefined` 를 돌려 not-found 처리를 Base 에 맡긴다. */
    execute(name: string, args: Record<string, unknown>, context?: UserContext): Promise<MCPToolResult | undefined>;
    /** 오타 교정 제안용 — 이 사용자가 쓸 수 있는 외부 도구 이름 */
    knownToolNames(userId?: string): Promise<string[]>;
}

export interface DispatchDeps {
    /** 내장 도구 목록 — 호출 시점에 읽는다(add-on 기여가 부팅 시점이라 스냅샷 불가) */
    builtInTools: () => MCPToolDefinition[];
    /** 외부 도구 위임자 — MCP 런타임이 등록됐을 때만 */
    external?: ExternalToolDispatch;
}

/** 외부 도구 출력 크기 제한(MAX_OUTPUT_SIZE, 1MB) — 대용량 결과가 통째로 컨텍스트에 주입되는 것을 막는다. */
export function capToolOutput(result: MCPToolResult): MCPToolResult {
    if (result?.content) {
        for (const item of result.content) {
            if ('text' in item && typeof item.text === 'string' && item.text.length > MCP_EXTERNAL_TOOL_LIMITS.MAX_OUTPUT_SIZE) {
                item.text = item.text.substring(0, MCP_EXTERNAL_TOOL_LIMITS.MAX_OUTPUT_SIZE) + '\n... (출력이 1MB를 초과하여 잘렸습니다)';
            }
        }
    }
    return result;
}

/**
 * 도구 실행 — 내장이면 직접 handler, `::` 이름이면 등록된 외부 위임자.
 *
 * 모든 에러 반환은 fail() 을 통과해 category/retryable span 속성과 교정 힌트를 얻는다.
 * 성공/실패 모두 finalize() 로 정규화한다(외부/내장 도구가 isError 를 반환하는 경우 포함).
 */
export async function dispatchTool(
    name: string,
    argsIn: Record<string, unknown>,
    context: UserContext | undefined,
    deps: DispatchDeps,
): Promise<MCPToolResult> {
    // pre 훅이 인자를 치환할 수 있어 let — 아래 모든 호출 경로가 이 args 를 쓴다.
    let args = argsIn;
    const isExternal = name.includes(MCP_NAMESPACE_SEPARATOR);
    return withSpan('mcp.tool-router', `tool.execute:${name}`, async (span) => {
        const startedAt = Date.now();
        span.setAttribute('tool.name', name);
        span.setAttribute('tool.external', isExternal);

        const ok = (result: MCPToolResult): MCPToolResult => {
            span.setAttribute('tool.duration_ms', Date.now() - startedAt);
            span.setAttribute('tool.success', true);
            recordToolResult(name, true);
            return result;
        };
        /** `record:false` 는 서킷 자신이 낸 거절 — 세면 차단이 스스로를 연장한다. */
        const fail = (rawMessage: string, opts: { record?: boolean } = {}): MCPToolResult => {
            const c = classifyToolError(rawMessage);
            if (opts.record !== false) recordToolResult(name, false, c.category);
            span.setAttribute('tool.duration_ms', Date.now() - startedAt);
            span.setAttribute('tool.success', false);
            span.setAttribute('tool.error_category', c.category);
            span.setAttribute('tool.error_retryable', c.retryable);
            logger.warn(`Tool error [${name}] category=${c.category} retryable=${c.retryable}: ${rawMessage}`);
            // 분류를 결과에 실어 감사 계층(tool-execution-guard)이 영속하게 한다.
            // 소비자에게 새 필드가 새지 않도록 그 계층이 기록 직후 제거한다.
            return {
                content: [{ type: 'text', text: formatToolError(rawMessage, c) }],
                isError: true,
                errorCategory: c.category,
                retryable: c.retryable,
            };
        };
        const hookCtx: ToolHookContext = {
            name, external: isExternal, startedAt,
            userId: context?.userId != null ? String(context.userId) : undefined, role: context?.role,
        };
        // 도구가 isError 결과를 반환하면 분류·교정해 정규화, 정상이면 그대로 통과.
        // post 훅(F13.5)은 정규화 전에 돈다 — 훅이 결과를 바꾸면 그 결과가 분류된다.
        const finalize = async (raw: MCPToolResult): Promise<MCPToolResult> => {
            const result = await runPostHooks(raw, hookCtx);
            if (result?.isError) {
                const text = (result.content ?? [])
                    .map((c) => ('text' in c && typeof c.text === 'string' ? c.text : ''))
                    .filter(Boolean)
                    .join('\n') || '도구 실행 오류';
                return fail(text);
            }
            return ok(result);
        };

        // 서킷 차단 도구는 실행하지 않고 즉시 거절한다. 노출에서 빠져도 모델이 이름을
        // 기억해 호출할 수 있으므로 2차 방어가 필요하다(그리고 죽은 서버를 두드리지 않는다).
        if (isToolCircuitOpen(name)) {
            return fail(
                `도구 "${name}" 은 반복 실패로 일시 비활성화되었습니다. 잠시 후 자동으로 재시도되며, 지금은 다른 도구나 방법을 사용하세요.`,
                { record: false },
            );
        }

        // 역할 게이트 2차 방어 — 노출 필터(filterRestrictedTools)에서 빠진 고위험 서버 도구를
        // 프롬프트 인젝션·REST 직접 호출로 지목해도 실행하지 않는다(B7-01). context 없는
        // 호출은 서버 내부 신뢰 경계라 종전대로 통과.
        if (context && isToolRestrictedForRole(name, context.role)) {
            return fail(`도구 "${name}" 은 현재 역할(${context.role})로 실행할 수 없습니다.`, { record: false });
        }

        // pre 훅(F13.5) — 서킷·역할 게이트 뒤, 실제 호출 앞. deny 는 서킷 집계에 넣지 않는다(도구 잘못이 아니다).
        const pre = await runPreHooks(args, hookCtx);
        if (pre.deny) return fail(`도구 "${name}" 호출이 정책 훅에 의해 거절되었습니다: ${pre.deny}`, { record: false });
        args = pre.args;

        const suggest = async (message: string): Promise<string> =>
            withToolNameSuggestions(message, name, [
                ...deps.builtInTools().map(d => d.tool.name),
                ...(deps.external ? await deps.external.knownToolNames(context?.userId != null ? String(context.userId) : undefined) : []),
            ]);

        // 1. 외부 도구 (:: 네임스페이스) — MCP 런타임 add-on 이 등록됐을 때만
        if (isExternal) {
            if (!deps.external) {
                return fail(await suggest(`외부 도구를 실행할 런타임이 없습니다: ${name}`));
            }
            try {
                const result = await deps.external.execute(name, args, context);
                if (result === undefined) return fail(await suggest(`외부 도구를 찾을 수 없습니다: ${name}`));
                return finalize(capToolOutput(result));
            } catch (error) {
                return fail(error instanceof Error ? error.message : '외부 도구 실행 실패');
            }
        }

        // 2. 내장 도구
        const builtIn = deps.builtInTools().find((def: MCPToolDefinition) => def.tool.name === name);
        if (builtIn) {
            // 실행 시점 required 인자 검증 — 지금까지 inputSchema.required 는 LLM 노출용으로만
            // 쓰여, 모델이 인자 JSON 을 누락/절단해 보내면 핸들러 깊숙이 undefined 가 흘러들어
            // 런타임 에러로 터졌다 (2026-07-17 web_search query 누락 → performWebSearch
            // toLowerCase TypeError). 단일 chokepoint 에서 차단하고, 모델이 다음 턴에 자가
            // 교정할 수 있는 invalid_args 에러로 반환한다. (외부 MCP 도구는 각 서버가 자체 검증)
            const missing = (builtIn.tool.inputSchema.required ?? [])
                .filter((key) => args[key] === undefined || args[key] === null);
            if (missing.length > 0) {
                return fail(`필수 인자 누락 (${name}): ${missing.join(', ')} — 누락된 인자를 모두 포함해 도구를 다시 호출하세요.`);
            }
            try {
                return finalize(await builtIn.handler(args, context));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return fail(`도구 실행 오류 (${name}): ${message}`);
            }
        }

        return fail(await suggest(`도구를 찾을 수 없습니다: ${name}`));
    });
}
