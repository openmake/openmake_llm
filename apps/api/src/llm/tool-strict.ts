import type { ToolDefinition } from './types';
import { LOCAL_TOOL_STRICT_ENABLED } from '../config/llm-parameters';
import { createLogger } from '../utils/logger';

const logger = createLogger('ToolStrict');

export interface ToolStrictContext {
    /** 외부 provider 클라이언트(quotaExempt) — OpenAI strict 규격이 달라 건너뛴다 */
    external?: boolean;
}

/** 한 번 경고한 도구는 다시 알리지 않는다 — 턴마다 같은 줄이 쌓이는 것을 막되 존재는 남긴다. */
const warned = new Set<string>();

/** PURE: `#/a/b` JSON Pointer 가 이 문서 안에서 실제로 풀리는지. */
function resolves(root: unknown, ref: string): boolean {
    if (ref === '#') return true;
    if (!ref.startsWith('#/')) return false;   // 외부 문서(`http…`)·anchor(`#Foo`) 는 못 푼다
    let cur: unknown = root;
    for (const raw of ref.slice(2).split('/')) {
        const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
        if (!cur || typeof cur !== 'object') return false;
        cur = (cur as Record<string, unknown>)[key];
        if (cur === undefined) return false;
    }
    return true;
}

/**
 * PURE: 해결할 수 없는 `$ref` 키만 걷어낸 스키마 사본. 없으면 `null`(호출부가 원본을 그대로 쓴다).
 *
 * MCP 서버가 `{"$ref": "#/definitions/Timestamp"}` 를 주면서 정작 `definitions` 를 함께 보내지
 * 않는 경우가 실재한다(2026-09-10 라이브: apollo graphos 의 GetTopOperations·GetOperationMetrics·
 * GetSubgraphMetrics). strict 가 켜지면 vLLM 이 이 참조를 풀지 못해 문법 컴파일에 실패하고
 * **요청 전체가 500** 이 된다.
 *
 * ⚠️ 그 도구만 strict 에서 빼는 것으로는 낫지 않는다 — vLLM 은 strict 도구가 **하나라도** 있으면
 * 요청의 **모든** 도구 스키마를 문법으로 만든다(`_any_tool_strict`). 라이브에서 실제로 재현했다.
 * 그래서 참조를 지워 스키마 자체를 유효하게 만든다. 애초에 정의가 없어 검증할 수 없던 필드이므로
 * 잃는 제약은 없고, `description` 등 나머지 키와 다른 도구의 strict 강제는 그대로 남는다.
 * 해결되는 `$ref` 는 건드리지 않는다(vLLM 이 처리한다).
 */
export function stripUnresolvableRefs(schema: unknown): unknown | null {
    let changed = false;
    const seen = new WeakSet<object>();
    const walk = (node: unknown): unknown => {
        if (!node || typeof node !== 'object') return node;
        if (seen.has(node as object)) return node;    // 순환 방어 — 그 가지는 원본을 그대로 둔다
        seen.add(node as object);
        if (Array.isArray(node)) return node.map(walk);
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
            if (k === '$ref' && typeof v === 'string' && !resolves(schema, v)) { changed = true; continue; }
            out[k] = walk(v);
        }
        return out;
    };
    const result = walk(schema);
    return changed ? result : null;
}

/**
 * 로컬 vLLM 요청의 도구 정의에 `strict: true` 를 채운다.
 * 게이트 OFF·외부 클라이언트·호출자가 strict 를 명시한 도구는 입력 그대로.
 * 근거·실측은 `config/llm-parameters.ts` `LOCAL_TOOL_STRICT_ENABLED` 주석 참고.
 */
export function applyLocalToolStrict(
    tools: ToolDefinition[] | undefined,
    ctx: ToolStrictContext = {},
): ToolDefinition[] | undefined {
    if (!tools || !LOCAL_TOOL_STRICT_ENABLED || ctx.external) return tools;
    return tools.map((t) => {
        if (t.function.strict !== undefined) return t;
        const cleaned = stripUnresolvableRefs(t.function.parameters);
        if (cleaned && !warned.has(t.function.name)) {
            warned.add(t.function.name);
            logger.warn(`${t.function.name}: 스키마의 해결 불가 $ref 를 제거했습니다 — `
                + '그대로 두면 문법 강제 시 upstream 이 요청 전체를 거부합니다.');
        }
        return {
            ...t,
            function: {
                ...t.function,
                ...(cleaned ? { parameters: cleaned as ToolDefinition['function']['parameters'] } : {}),
                strict: true,
            },
        };
    });
}
