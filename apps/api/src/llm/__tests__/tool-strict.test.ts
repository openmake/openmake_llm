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
    return { apply: mod.applyLocalToolStrict, strip: mod.stripUnresolvableRefs, toOpenAITools: sp.toOpenAITools };
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

/** 해결 불가 $ref — 남겨두면 문법 강제 시 upstream 이 요청 전체를 거부한다(2026-09-10 라이브 재현). */
describe('stripUnresolvableRefs', () => {
    it('definitions 가 없는 $ref 는 제거하고 나머지 키는 남긴다', () => {
        const { strip } = load();
        const out = strip({
            type: 'object',
            properties: { from: { description: 'start', $ref: '#/definitions/Timestamp' } },
        }) as { properties: { from: Record<string, unknown> } };
        expect(out.properties.from).toEqual({ description: 'start' });
    });

    it('가리키는 정의가 실재하면 건드리지 않는다(null)', () => {
        const { strip } = load();
        expect(strip({
            type: 'object',
            definitions: { Timestamp: { type: 'string' } },
            properties: { from: { $ref: '#/definitions/Timestamp' } },
        })).toBeNull();
        expect(strip({ $defs: { T: { type: 'string' } }, properties: { a: { $ref: '#/$defs/T' } } })).toBeNull();
    });

    it('배열 안쪽·중첩도 따라간다', () => {
        const { strip } = load();
        const out = strip({
            properties: { list: { type: 'array', items: { $ref: '#/$defs/Missing' } } },
        }) as { properties: { list: { items: Record<string, unknown> } } };
        expect(out.properties.list.items).toEqual({});
    });

    it('외부 문서 참조와 anchor 형태도 제거 대상', () => {
        const { strip } = load();
        expect(strip({ properties: { a: { $ref: 'https://example.com/s.json' } } })).not.toBeNull();
        expect(strip({ properties: { a: { $ref: '#Timestamp' } } })).not.toBeNull();
    });

    it('$ref 가 없으면 null, 순환 객체에서도 멈춘다', () => {
        const { strip } = load();
        expect(strip({ type: 'object', properties: { a: { type: 'string' } } })).toBeNull();
        const cyclic: Record<string, unknown> = { type: 'object' };
        cyclic.self = cyclic;
        expect(strip(cyclic)).toBeNull();
    });

    it('원본을 변경하지 않는다', () => {
        const { strip } = load();
        const input = { properties: { from: { $ref: '#/definitions/Missing' } } };
        strip(input);
        expect(input.properties.from.$ref).toBe('#/definitions/Missing');
    });
});

describe('applyLocalToolStrict — 해결 불가 $ref 도구', () => {
    const refTool = (name: string): ToolDefinition => ({
        type: 'function',
        function: {
            name,
            description: 'd',
            parameters: {
                type: 'object',
                properties: { from: { $ref: '#/definitions/Timestamp' } },
                required: ['from'],
            } as unknown as ToolDefinition['function']['parameters'],
        },
    });

    it('참조를 지운 스키마로 strict 를 유지한다 — 도구별 해제로는 요청이 살지 않는다', () => {
        const { apply } = load();
        const out = apply([refTool('bad'), tool('good')]);
        expect(out?.[0].function.strict).toBe(true);
        expect(JSON.stringify(out?.[0].function.parameters)).not.toContain('$ref');
        expect(JSON.stringify(out?.[0].function.parameters)).toContain('required');
        expect(out?.[1].function.strict).toBe(true);
    });

    it('도구는 그대로 노출된다(제거하지 않는다)', () => {
        const { apply } = load();
        expect(apply([refTool('bad')])).toHaveLength(1);
    });
});
