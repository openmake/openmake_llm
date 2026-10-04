/**
 * spawn_agents 결과 형식 계약 — 태스크가 JSON 스키마(선택)를 주면 서브에이전트의 최종 답을 결정적으로 검증한다.
 *
 * 검증은 모델을 부르지 않는다(JSON 추출 + 스키마 대조). 어긋나면 서브에이전트에게 교정을 한 번만 요청하고,
 * 그래도 어긋나면 결과를 버리지 않고 "형식 검증 실패" 판정과 함께 부모에게 돌려준다.
 * 기본 켜짐 — 실측 근거는 AGENT_DELEGATION.OUTPUT_SCHEMA_ENABLED 의 주석에 있다.
 *
 * @module services/agent-spawn/output-schema
 */
import { z } from 'zod';
import { AGENT_DELEGATION } from '../../config/agent-task-delegation';
import {
    getOutputSchemaInstruction, getOutputSchemaTooLarge, getOutputSchemaInvalid, OUTPUT_SCHEMA_NO_JSON,
} from '../../prompts/agent-task-delegation';

export interface OutputContract {
    /** 서브에이전트 지시문 뒤에 붙일 결과 형식 안내. */
    instruction: string;
    /** 결과가 스키마에 맞으면 null, 아니면 어디가 어긋났는지. */
    check(text: string): string | null;
}

const tryParse = (s: string): unknown => {
    try { return JSON.parse(s); } catch { return undefined; }
};

/** PURE: 답에서 JSON 값을 꺼낸다 — 본문 전체 → 코드 울타리 안 → 첫 여는 괄호부터 마지막 닫는 괄호까지. 없으면 undefined. */
export function extractJson(text: string): unknown {
    const whole = tryParse(text.trim());
    if (whole !== undefined) return whole;
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const inFence = fenced ? tryParse(fenced[1].trim()) : undefined;
    if (inFence !== undefined) return inFence;
    for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
        const start = text.indexOf(open);
        const end = text.lastIndexOf(close);
        const inner = start >= 0 && end > start ? tryParse(text.slice(start, end + 1)) : undefined;
        if (inner !== undefined) return inner;
    }
    return undefined;
}

/** PURE: 스키마를 검증기로 만든다. 스키마 자체가 잘못됐거나 너무 크면 `{ error }`. */
export function compileOutputContract(schema: Record<string, unknown>): OutputContract | { error: string } {
    const json = JSON.stringify(schema);
    if (json.length > AGENT_DELEGATION.OUTPUT_SCHEMA_MAX_CHARS) {
        return { error: getOutputSchemaTooLarge(json.length, AGENT_DELEGATION.OUTPUT_SCHEMA_MAX_CHARS) };
    }
    let validator: z.ZodType;
    try {
        validator = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
    } catch (e) {
        return { error: getOutputSchemaInvalid(e instanceof Error ? e.message : String(e)) };
    }
    return {
        instruction: getOutputSchemaInstruction(json),
        check(text: string): string | null {
            const value = extractJson(text);
            if (value === undefined) return OUTPUT_SCHEMA_NO_JSON;
            const parsed = validator.safeParse(value);
            if (parsed.success) return null;
            return parsed.error.issues.slice(0, AGENT_DELEGATION.OUTPUT_SCHEMA_MAX_ISSUES)
                .map((issue) => `${issue.path.join('.') || '(최상위)'}: ${issue.message}`).join('; ');
        },
    };
}
