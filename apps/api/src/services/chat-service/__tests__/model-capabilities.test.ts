/**
 * model-capabilities 단위 테스트 — capability 출처 우선순위.
 *
 * 라이브 실측(2026-07-26): 외부 provider 의 getCapabilities 가 모델 ID 휴리스틱이라
 * 진짜 비전 모델(meta/llama-4-maverick…)을 vision:false 로 오판 → 이미지 요청이
 * 400 으로 조기 차단됐다. 카탈로그 우선 해석과 출처 표기를 고정한다.
 */
import { resolveModelCapabilities } from '../model-capabilities';
import type { ResolvedProvider } from '../../../providers/provider-router';
import type { ProviderCapabilities } from '../../../providers/i-provider';

const HEURISTIC: ProviderCapabilities = {
    streaming: true, toolCalling: true, vision: false, thinking: false,
};

function makeResolved(providerId: string, modelId: string): ResolvedProvider {
    return {
        providerId,
        modelId,
        fullId: `${providerId}:${modelId}`,
        provider: {
            id: providerId,
            sdkType: 'openai-compatible',
            displayName: providerId,
            getCapabilities: () => HEURISTIC,
            listModels: async () => [],
            validateCredentials: async () => ({ ok: true }),
            streamChat: async () => ({ content: '', usage: {}, finishReason: 'stop' as const }),
        },
    } as unknown as ResolvedProvider;
}

function makeRepo(cached: unknown[] | null) {
    return {
        getCachedModels: jest.fn().mockResolvedValue(cached),
    } as never;
}

describe('resolveModelCapabilities', () => {
    it('로컬은 프리셋을 그대로 신뢰한다 (source=local)', async () => {
        const r = await resolveModelCapabilities(makeResolved('local-llm', 'qwen3.6-35b-a3b'));
        expect(r.source).toBe('local');
        expect(r.caps).toEqual(HEURISTIC);
    });

    it('라이브 카탈로그 캐시가 있으면 최우선 채택한다 (source=catalog)', async () => {
        const repo = makeRepo([
            { id: 'meta/llama-4-maverick', capabilities: { vision: true, toolCalling: true, streaming: true, thinking: false } },
        ]);
        const r = await resolveModelCapabilities(makeResolved('nvidia', 'meta/llama-4-maverick'), 'u1', repo);
        expect(r.source).toBe('catalog');
        expect(r.caps.vision).toBe(true); // 휴리스틱은 false 였음
    });

    it('캐시 미스면 config 카탈로그(fallbackModels)를 쓴다 (source=config)', async () => {
        const repo = makeRepo(null);
        // nvidia 카탈로그에 등록된 실제 비전 모델
        const r = await resolveModelCapabilities(
            makeResolved('nvidia', 'meta/llama-4-maverick-17b-128e-instruct'), 'u1', repo,
        );
        expect(r.source).toBe('config');
        expect(r.caps.vision).toBe(true); // 카탈로그가 vision:true — 휴리스틱 오판 교정
    });

    it('둘 다 없으면 휴리스틱으로 수렴하고 출처를 표시한다 (source=heuristic)', async () => {
        const repo = makeRepo(null);
        const r = await resolveModelCapabilities(makeResolved('nvidia', 'unknown/model-x'), 'u1', repo);
        expect(r.source).toBe('heuristic');
        expect(r.caps).toEqual(HEURISTIC);
    });

    it('캐시 조회가 실패해도 예외를 던지지 않는다 (graceful)', async () => {
        const repo = { getCachedModels: jest.fn().mockRejectedValue(new Error('db down')) } as never;
        const r = await resolveModelCapabilities(makeResolved('nvidia', 'unknown/model-y'), 'u1', repo);
        expect(r.source).toBe('heuristic');
    });

    it('userId·repo 가 없으면 config → heuristic 순으로만 해석한다', async () => {
        const r = await resolveModelCapabilities(makeResolved('chatgpt', 'gpt-5.4'));
        expect(r.source).toBe('config'); // chatgpt 카탈로그에 gpt-5.4 등록됨
        expect(r.caps.vision).toBe(true);
    });
});
