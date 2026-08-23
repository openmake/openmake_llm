/**
 * 유효 컨텍스트 해석 — 262K 고정으로 인해 모델 교체 시 안전망이 무력화되던 문제 회귀.
 *
 * 과거 구조: `MODEL_POOL_CONFIG.effectiveDefault` = 262144 * 0.9 고정.
 * 컨텍스트가 더 짧은 모델(예: 32K)로 교체하면 임계에 영영 못 닿아 그대로 전송 → upstream 400,
 * 더 긴 모델이면 불필요하게 잘라냈다. 이제 부팅 프로브 실측치를 쓴다.
 */
import type { LocalModelEntry } from './local-models';

const mockEntries: LocalModelEntry[] = [];
jest.mock('./local-models', () => ({
    findLocalModel: (id: string) => mockEntries.find((m) => m.id === id),
}));

describe('resolveEffectiveContext', () => {
    const savedCtx = process.env.LLM_POOL_DEFAULT_CTX;
    const savedMargin = process.env.LLM_POOL_DEFAULT_MARGIN_PCT;

    function load(): typeof import('./model-pool') {
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('./model-pool');
    }

    beforeEach(() => {
        mockEntries.length = 0;
        delete process.env.LLM_POOL_DEFAULT_CTX;
        delete process.env.LLM_POOL_DEFAULT_MARGIN_PCT;
    });
    afterAll(() => {
        if (savedCtx !== undefined) process.env.LLM_POOL_DEFAULT_CTX = savedCtx;
        if (savedMargin !== undefined) process.env.LLM_POOL_DEFAULT_MARGIN_PCT = savedMargin;
    });

    it('실측치가 없으면 기본값 262144 에 마진 10% (기존 동작)', () => {
        expect(load().resolveEffectiveContext('unknown-model')).toBe(235929);
    });

    it('부팅 프로브 실측치를 반영한다 — 짧은 모델 (핵심 회귀)', () => {
        mockEntries.push({
            id: 'short-model', displayName: 's', description: '', role: 'chat',
            contextLength: 32768, contextLengthProbed: true,
        });
        // 32768 * 0.9 = 29491 — 262144 고정이었다면 임계에 못 닿아 안전망이 죽었다.
        expect(load().resolveEffectiveContext('short-model')).toBe(29491);
    });

    it('부팅 프로브 실측치를 반영한다 — 긴 모델 (불필요한 절단 방지)', () => {
        mockEntries.push({
            id: 'long-model', displayName: 'l', description: '', role: 'chat',
            contextLength: 1_048_576, contextLengthProbed: true,
        });
        expect(load().resolveEffectiveContext('long-model')).toBe(943718);
    });

    it('env 명시값이 실측치를 이긴다 (운영자 override 우선)', () => {
        process.env.LLM_POOL_DEFAULT_CTX = '65536';
        mockEntries.push({
            id: 'short-model', displayName: 's', description: '', role: 'chat',
            contextLength: 32768, contextLengthProbed: true,
        });
        expect(load().resolveEffectiveContext('short-model')).toBe(58982);
    });

    it('modelId 미지정이면 기본값을 쓴다', () => {
        expect(load().resolveEffectiveContext()).toBe(235929);
    });
});
