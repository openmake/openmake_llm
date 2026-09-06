/**
 * 로컬 도구 strict — env 게이트에 의존하므로 모듈을 격리 로드한다(운영 .env 값이 섞이지 않게).
 */
export {};

import type { ToolDefinition } from '../types';

const ENV_KEY = 'LLM_LOCAL_TOOL_STRICT';
let saved: string | undefined;

function load(value?: string) {
    delete process.env[ENV_KEY];
    if (value !== undefined) process.env[ENV_KEY] = value;
    jest.resetModules();
    const mod = require('../tool-strict') as typeof import('../tool-strict');
    const sp = require('../stream-parser') as typeof import('../stream-parser');
    return { apply: mod.applyLocalToolStrict, toOpenAITools: sp.toOpenAITools };
}

const tool = (name: string, strict?: boolean): ToolDefinition => ({
    type: 'function',
    function: {
        name,
        description: 'd',
        parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        ...(strict !== undefined && { strict }),
    },
});

beforeAll(() => { saved = process.env[ENV_KEY]; });
afterAll(() => { if (saved === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = saved; });

describe('applyLocalToolStrict', () => {
    it('기본(게이트 on) → 로컬 도구에 strict:true 를 채운다', () => {
        const { apply } = load();
        const out = apply([tool('a'), tool('b')]);
        expect(out?.map((t) => t.function.strict)).toEqual([true, true]);
    });

    it('호출자가 strict 를 명시한 도구는 덮어쓰지 않는다', () => {
        const { apply } = load();
        const out = apply([tool('a', false), tool('b')]);
        expect(out?.map((t) => t.function.strict)).toEqual([false, true]);
    });

    it('외부 클라이언트(quotaExempt) 는 입력 그대로 — OpenAI strict 규격이 달라 400 위험', () => {
        const { apply } = load();
        const input = [tool('a')];
        expect(apply(input, { external: true })).toBe(input);
        expect(input[0].function.strict).toBeUndefined();
    });

    it("LLM_LOCAL_TOOL_STRICT=false → 종전처럼 미전송", () => {
        const { apply } = load('false');
        const input = [tool('a')];
        expect(apply(input)).toBe(input);
    });

    it('wire 변환이 strict 를 그대로 싣고, 없으면 키 자체를 내지 않는다', () => {
        const { apply, toOpenAITools } = load();
        const wire = toOpenAITools(apply([tool('a')]) ?? []) as Array<{ function: Record<string, unknown> }>;
        expect(wire[0].function.strict).toBe(true);
        const plain = toOpenAITools([tool('b')]) as Array<{ function: Record<string, unknown> }>;
        expect('strict' in plain[0].function).toBe(false);
    });

    it('undefined 입력은 undefined', () => {
        const { apply } = load();
        expect(apply(undefined)).toBeUndefined();
    });

    it('입력 배열·객체를 변경하지 않는다(순수)', () => {
        const { apply } = load();
        const input = [tool('a')];
        const out = apply(input);
        expect(out).not.toBe(input);
        expect(input[0].function.strict).toBeUndefined();
        expect(out?.[0].function.parameters).toBe(input[0].function.parameters);
    });
});
