// TOOL_ARGS_* 는 .env 에 좌우되므로 고정해 결정적으로 만든다.
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return {
        ...actual,
        AGENT_TASK_LIMITS: {
            ...actual.AGENT_TASK_LIMITS,
            TOOL_ARGS_PERSIST_ENABLED: true,
            TOOL_ARGS_MAX_CHARS: 200,
        },
    };
});

import { prepareToolArgs } from './tool-args';

describe('prepareToolArgs', () => {
    it('민감 키 값을 마스킹한다 (중첩 포함)', () => {
        const out = prepareToolArgs({
            url: 'https://example.com',
            headers: { authorization: 'Bearer abc', 'x-api-key': 'sk-live-1' },
            nested: { deep: { password: 'p@ss' } },
        }) as Record<string, unknown>;

        expect(out.url).toBe('https://example.com');
        expect(out.headers).toEqual({ authorization: '[REDACTED]', 'x-api-key': '[REDACTED]' });
        expect((out.nested as { deep: { password: string } }).deep.password).toBe('[REDACTED]');
    });

    it('민감하지 않은 값은 원형을 유지한다', () => {
        expect(prepareToolArgs({ path: '/workspace/a.py', lines: 10, ok: true }))
            .toEqual({ path: '/workspace/a.py', lines: 10, ok: true });
    });

    it('캡을 넘으면 절단 표식으로 대체한다', () => {
        const out = prepareToolArgs({ content: 'x'.repeat(500) }) as Record<string, unknown>;
        expect(out._truncated).toBe(true);
        expect(out._chars).toBeGreaterThan(200);
        expect(String(out.preview)).toHaveLength(200);
    });

    it('긴 배열은 앞부분만 남기고 잔여 개수를 표기한다', () => {
        const out = prepareToolArgs({ items: Array.from({ length: 25 }, (_, i) => i) }) as { items: unknown[] };
        expect(out.items).toHaveLength(21);
        expect(out.items[20]).toBe('[+5 more]');
    });

    it('빈 인자·null 은 저장하지 않는다(undefined)', () => {
        expect(prepareToolArgs({})).toBeUndefined();
        expect(prepareToolArgs(null)).toBeUndefined();
        expect(prepareToolArgs(undefined)).toBeUndefined();
    });

    it('순환 참조는 깊이 제한에서 끊긴다 (throw 없음)', () => {
        const cyclic: Record<string, unknown> = { a: 1 };
        cyclic.self = cyclic;
        expect(() => prepareToolArgs(cyclic)).not.toThrow();
        expect(JSON.stringify(prepareToolArgs(cyclic))).toContain('[DEPTH_LIMIT]');
    });

    it('직렬화 불가 값은 관측을 포기한다 (실행은 계속)', () => {
        expect(prepareToolArgs({ n: BigInt(1) })).toBeUndefined();
    });
});
