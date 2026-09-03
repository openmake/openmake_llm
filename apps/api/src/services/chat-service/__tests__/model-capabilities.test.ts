/**
 * model-capabilities 단위 테스트 — capability 출처 우선순위.
 *
 * 라이브 실측(2026-07-26): 외부 provider 의 getCapabilities 가 모델 ID 휴리스틱이라
 * 진짜 비전 모델(meta/llama-4-maverick…)을 vision:false 로 오판 → 이미지 요청이
 * 400 으로 조기 차단됐다. 카탈로그 우선 해석과 출처 표기를 고정한다.
 */
import { resolveModelCapabilities, toCachedModelEntry } from '../model-capabilities';
import type { ProviderModel } from '../../../providers/i-provider';
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

    it('provider 가 보고한 라이브 카탈로그 캐시는 최우선 채택한다 (source=catalog)', async () => {
        const repo = makeRepo([
            { id: 'meta/llama-4-maverick', capabilitiesInferred: false, capabilities: { vision: true, toolCalling: true, streaming: true, thinking: false } },
        ]);
        const r = await resolveModelCapabilities(makeResolved('nvidia', 'meta/llama-4-maverick'), 'u1', repo);
        expect(r.source).toBe('catalog');
        expect(r.caps.vision).toBe(true); // 휴리스틱은 false 였음
    });

    it('휴리스틱 추정 캐시(capabilitiesInferred=true)는 config 실측값을 가리지 못한다 (2026-09-03 B.AI)', async () => {
        // B.AI /models 는 capability 를 안 주므로 listModels 가 휴리스틱(vision/thinking=false)으로 채워 캐시한다.
        const repo = makeRepo([
            { id: 'qwen3.8-flash', capabilitiesInferred: true, capabilities: { vision: false, toolCalling: true, streaming: true, thinking: false } },
        ]);
        const r = await resolveModelCapabilities(makeResolved('bai', 'qwen3.8-flash'), 'u1', repo);
        expect(r.source).toBe('config');
        expect(r.caps.vision).toBe(true);
        expect(r.caps.thinking).toBe(true);
    });

    it('레거시 캐시 행(capabilitiesInferred 없음)도 추정으로 간주해 config 를 우선한다', async () => {
        const repo = makeRepo([
            { id: 'qwen3.8-flash', capabilities: { vision: false, toolCalling: true, streaming: true, thinking: false } },
        ]);
        const r = await resolveModelCapabilities(makeResolved('bai', 'qwen3.8-flash'), 'u1', repo);
        expect(r.source).toBe('config');
        expect(r.caps.vision).toBe(true);
    });

    it('추정 캐시 + config 미등록 모델은 휴리스틱으로 수렴한다', async () => {
        const repo = makeRepo([
            { id: 'unknown-model-x', capabilitiesInferred: true, capabilities: { vision: false, toolCalling: true, streaming: true, thinking: false } },
        ]);
        const r = await resolveModelCapabilities(makeResolved('bai', 'unknown-model-x'), 'u1', repo);
        expect(r.source).toBe('heuristic');
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

describe('toCachedModelEntry — 캐시 쓰기 형태가 읽기 채택 조건을 보존한다', () => {
    // 2026-09-04 운영 실측: model.routes 가 필드를 손으로 골라 복사하다 capabilitiesInferred 를 떨어뜨려
    // 캐시 전 행이 undefined → ② 의 `=== false` 채택이 영구 거짓(#713 무력, B.AI vision 거절 재현).
    function makeModel(over: Partial<ProviderModel>): ProviderModel {
        return {
            id: 'm', fullId: 'p:m', displayName: 'M', contextWindow: 1, outputLimit: 1,
            capabilities: { vision: true, toolCalling: true, streaming: true, thinking: false },
            ...over,
        } as ProviderModel;
    }

    it('capabilitiesInferred=false 를 보존해 실보고 행이 catalog 로 채택된다', async () => {
        const row = toCachedModelEntry(makeModel({ id: 'meta/llama-4-maverick', capabilitiesInferred: false }));
        expect(row.capabilitiesInferred).toBe(false);
        const r = await resolveModelCapabilities(makeResolved('nvidia', 'meta/llama-4-maverick'), 'u1', makeRepo([row]));
        expect(r.source).toBe('catalog');
        expect(r.caps.vision).toBe(true);
    });

    it('capabilitiesInferred=true 를 보존해 휴리스틱 행이 config 를 가리지 않는다', async () => {
        const row = toCachedModelEntry(makeModel({
            id: 'qwen3.8-flash', capabilitiesInferred: true,
            capabilities: { vision: false, toolCalling: true, streaming: true, thinking: false },
        }));
        expect(row.capabilitiesInferred).toBe(true);
        const r = await resolveModelCapabilities(makeResolved('bai', 'qwen3.8-flash'), 'u1', makeRepo([row]));
        expect(r.source).toBe('config');
        expect(r.caps.vision).toBe(true);
    });

    it('응답에 필요한 표시 필드(displayName·isFree·pricing)도 함께 남긴다', () => {
        const row = toCachedModelEntry(makeModel({ isFree: true, pricing: { input: 1, output: 2 } }));
        expect(row).toMatchObject({ id: 'm', fullId: 'p:m', displayName: 'M', isFree: true, pricing: { input: 1, output: 2 } });
    });
});
