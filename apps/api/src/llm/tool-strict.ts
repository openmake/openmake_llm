import type { ToolDefinition } from './types';
import { LOCAL_TOOL_STRICT_ENABLED } from '../config/llm-parameters';

export interface ToolStrictContext {
    /** 외부 provider 클라이언트(quotaExempt) — OpenAI strict 규격이 달라 건너뛴다 */
    external?: boolean;
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
    return tools.map((t) => (
        t.function.strict === undefined
            ? { ...t, function: { ...t.function, strict: true } }
            : t
    ));
}
