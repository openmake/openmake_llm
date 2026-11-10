/**
 * text.embed 는 코드·env 기본값이 없다 — 개인 → 전역 배정만 쓰고, 둘 다 없으면 미배정(2026-11-10).
 * 종전에는 배정이 없어도 `local-llm:bge-m3`(또는 CAPABILITY_DEFAULT_TEXT_EMBED)가 조용히 실행 대상이 됐다.
 * CAPABILITY_DEFAULTS 는 모듈 로딩 시 env 를 읽으므로 사례마다 env 를 먼저 넣고 모듈을 격리해 다시 불러온다.
 */
type Defaults = Partial<Record<string, string>>;

const ENV_KEYS = ['CAPABILITY_DEFAULT_TEXT_EMBED', 'CAPABILITY_DEFAULT_TEXT_REASON'] as const;
const saved: Record<string, string | undefined> = {};

function loadDefaults(env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): Defaults {
    for (const k of ENV_KEYS) {
        if (env[k] === undefined) delete process.env[k];
        else process.env[k] = env[k];
    }
    let defaults: Defaults = {};
    jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        defaults = (require('./capabilities') as typeof import('./capabilities')).CAPABILITY_DEFAULTS as Defaults;
    });
    return defaults;
}

beforeAll(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

describe('CAPABILITY_DEFAULTS — text.embed 기본값 없음', () => {
    it.each([
        ['미설정', undefined],
        ['빈 문자열', ''],
        ['none', 'none'],
        ['로컬 fullId', 'local-llm:fixture-embed'],
        ['외부 fullId', 'openrouter:fixture-embed'],
    ])('CAPABILITY_DEFAULT_TEXT_EMBED %s → text.embed 기본값 없음', (_label, value) => {
        const defaults = loadDefaults({ CAPABILITY_DEFAULT_TEXT_EMBED: value });
        expect(defaults['text.embed']).toBeUndefined();
        expect('text.embed' in defaults).toBe(false);
    });

    it('다른 capability 의 코드 기본값과 env override 는 유지한다', () => {
        expect(loadDefaults({})['text.reason']).toBe('local-llm:qwen3.8-27b');
        expect(loadDefaults({ CAPABILITY_DEFAULT_TEXT_REASON: 'local-llm:fixture-reason' })['text.reason']).toBe('local-llm:fixture-reason');
        expect(loadDefaults({ CAPABILITY_DEFAULT_TEXT_REASON: 'none' })['text.reason']).toBeUndefined();
    });
});
