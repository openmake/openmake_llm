/**
 * 로컬 샘플링 프리셋 — env 에 의존하므로 모듈을 격리 로드한다(운영 .env 의 값이 섞이지 않게).
 */
export {};

const ENV_KEYS = [
    'LLM_LOCAL_SAMPLING_PRESET_ENABLED', 'LLM_DISABLE_THINKING_BY_DEFAULT',
    'LLM_SAMPLING_THINKING_TEMP', 'LLM_SAMPLING_INSTRUCT_TEMP', 'LLM_SAMPLING_INSTRUCT_PRESENCE',
];
const saved: Record<string, string | undefined> = {};

function load(env: Record<string, string | undefined>) {
    for (const k of ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    jest.resetModules();
    const mod = require('../sampling-preset') as typeof import('../sampling-preset');
    const ra = require('../reasoning-adapter') as typeof import('../reasoning-adapter');
    return { applyPreset: mod.applyLocalSamplingPreset, isThinkingEnabled: ra.isThinkingEnabled };
}

beforeAll(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
afterAll(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('applyLocalSamplingPreset', () => {
    it('thinking OFF(명시) → INSTRUCT 프리셋 (공식 비추론 권장값)', () => {
        const { applyPreset } = load({});
        expect(applyPreset(undefined, false)).toEqual({
            temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5, repeat_penalty: 1.0,
        });
    });

    it('thinking ON(레벨) → THINKING 프리셋, 기존 num_predict 는 보존', () => {
        const { applyPreset } = load({});
        expect(applyPreset({ num_predict: 4096 }, 'medium')).toEqual({
            num_predict: 4096, temperature: 1.0, top_p: 0.95, top_k: 20, presence_penalty: 0, repeat_penalty: 1.0,
        });
    });

    it('think 미지정: env 기본 OFF 면 INSTRUCT, 아니면 THINKING(서버 기본 ON)', () => {
        expect(load({ LLM_DISABLE_THINKING_BY_DEFAULT: 'true' }).applyPreset(undefined, undefined)?.temperature).toBe(0.7);
        expect(load({ LLM_DISABLE_THINKING_BY_DEFAULT: 'false' }).applyPreset(undefined, undefined)?.temperature).toBe(1.0);
    });

    it('호출자가 샘플링을 하나라도 지정하면 그대로 (메타 호출 temperature 보호)', () => {
        const { applyPreset } = load({});
        const o = { temperature: 0.1, num_predict: 150 };
        expect(applyPreset(o, false)).toBe(o);
        const p = { top_p: 0.5 };
        expect(applyPreset(p, false)).toBe(p);
    });

    it('외부 provider 클라이언트는 건너뛴다', () => {
        const { applyPreset } = load({});
        expect(applyPreset(undefined, false, { external: true })).toBeUndefined();
    });

    it('게이트 OFF 면 입력 그대로', () => {
        const { applyPreset } = load({ LLM_LOCAL_SAMPLING_PRESET_ENABLED: 'false' });
        expect(applyPreset(undefined, false)).toBeUndefined();
    });

    it('env 로 개별 값 오버라이드', () => {
        const { applyPreset } = load({ LLM_SAMPLING_INSTRUCT_TEMP: '0.5', LLM_SAMPLING_INSTRUCT_PRESENCE: '1.2' });
        expect(applyPreset(undefined, false)).toMatchObject({ temperature: 0.5, presence_penalty: 1.2, top_p: 0.8 });
    });
});

describe('isThinkingEnabled', () => {
    it('false → off, 레벨/true → on, undefined → env', () => {
        const a = load({ LLM_DISABLE_THINKING_BY_DEFAULT: 'true' });
        expect(a.isThinkingEnabled(false)).toBe(false);
        expect(a.isThinkingEnabled(true)).toBe(true);
        expect(a.isThinkingEnabled('low')).toBe(true);
        expect(a.isThinkingEnabled(undefined)).toBe(false);
        expect(load({}).isThinkingEnabled(undefined)).toBe(true);
    });
});
