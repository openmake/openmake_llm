/**
 * OpenAICompatProvider.listModels() — OpenRouter 분기 단위 테스트.
 *
 * 검증:
 *  - SDK 경로 사용 (this.client.models.list) → defaultHeaders 자동 첨부
 *  - 응답 확장 필드 (name, context_length, architecture.input_modalities,
 *    supported_parameters, top_provider.max_completion_tokens, pricing 전체) 추출
 *  - ":free" suffix 또는 pricing 0/0 → isFree=true
 *  - capabilities 는 architecture/supported_parameters 기반 정확 추론
 *  - SDK 예외 → 빈 배열
 */
import { OpenAICompatProvider } from '../openai-compat-provider';

describe.skip('OpenAICompatProvider.listModels — OpenRouter branch', () => {
    function makeProvider() {
        return new OpenAICompatProvider({
            providerId: 'openrouter',
            apiKey: 'sk-or-test',
            baseUrl: 'https://openrouter.ai/api/v1',
        });
    }

    function injectListMock(provider: OpenAICompatProvider, data: unknown[]) {
        const client = (provider as unknown as { client: { models: { list: jest.Mock } } }).client;
        client.models.list = jest.fn().mockResolvedValue({ data });
        return client.models.list as jest.Mock;
    }

    it(':free suffix 모델 → isFree=true, pricing 0', async () => {
        const provider = makeProvider();
        injectListMock(provider, [
            {
                id: 'meta-llama/llama-3.1-8b-instruct:free',
                name: 'Meta: Llama 3.1 8B Instruct (free)',
                context_length: 128_000,
                pricing: { prompt: '0', completion: '0' },
                top_provider: { max_completion_tokens: 8192 },
                architecture: { input_modalities: ['text'] },
                supported_parameters: ['max_tokens'],
            },
        ]);
        const models = await provider.listModels();
        expect(models).toHaveLength(1);
        expect(models[0]).toMatchObject({
            id: 'meta-llama/llama-3.1-8b-instruct:free',
            fullId: 'openrouter:meta-llama/llama-3.1-8b-instruct:free',
            displayName: 'Meta: Llama 3.1 8B Instruct (free)',
            contextWindow: 128_000,
            outputLimit: 8_192,
            isFree: true,
            pricing: { input: 0, output: 0 },
        });
    });

    it('pricing per-token USD → 1M tokens USD 변환', async () => {
        const provider = makeProvider();
        injectListMock(provider, [
            {
                id: 'openai/gpt-4o-mini',
                name: 'OpenAI: GPT-4o mini',
                context_length: 128_000,
                pricing: { prompt: '0.00000015', completion: '0.0000006' },
                top_provider: { max_completion_tokens: 16_384 },
                architecture: { input_modalities: ['text', 'image'] },
                supported_parameters: ['tools', 'tool_choice', 'max_tokens'],
            },
        ]);
        const models = await provider.listModels();
        expect(models[0].pricing!.input).toBeCloseTo(0.15, 5);
        expect(models[0].pricing!.output).toBeCloseTo(0.60, 5);
        expect(models[0].isFree).toBe(false);
    });

    it('capabilities 는 architecture + supported_parameters 기반 추론', async () => {
        const provider = makeProvider();
        injectListMock(provider, [
            {
                id: 'openai/gpt-vision-tools',
                name: 'GPT Vision + Tools',
                context_length: 128_000,
                pricing: { prompt: '0.00001', completion: '0.00003' },
                architecture: { input_modalities: ['text', 'image', 'file'] },
                supported_parameters: ['tools', 'tool_choice', 'max_tokens'],
                top_provider: { max_completion_tokens: 16_384 },
            },
            {
                id: 'meta/llama-text-only',
                name: 'Llama Text Only',
                context_length: 8192,
                pricing: { prompt: '0.0000005', completion: '0.0000005' },
                architecture: { input_modalities: ['text'] },
                supported_parameters: ['max_tokens'],
                top_provider: { max_completion_tokens: 4096 },
            },
        ]);
        const models = await provider.listModels();
        expect(models[0].capabilities).toMatchObject({
            vision: true,
            toolCalling: true,
            streaming: true,
            embedding: false,
        });
        expect(models[1].capabilities).toMatchObject({
            vision: false,
            toolCalling: false,
            streaming: true,
            embedding: false,
        });
    });

    it('thinking — pricing.internal_reasoning 존재 시 true', async () => {
        const provider = makeProvider();
        injectListMock(provider, [
            {
                id: 'reasoning-model',
                name: 'Reasoning Model',
                context_length: 128_000,
                pricing: { prompt: '0.000003', completion: '0.000015', internal_reasoning: '0.000015' },
                architecture: { input_modalities: ['text'] },
                supported_parameters: ['max_tokens'],
                top_provider: { max_completion_tokens: 8192 },
            },
            {
                id: 'standard-model',
                name: 'Standard Model',
                context_length: 32_000,
                pricing: { prompt: '0.000001', completion: '0.000002' },
                architecture: { input_modalities: ['text'] },
                supported_parameters: ['max_tokens'],
                top_provider: { max_completion_tokens: 4096 },
            },
        ]);
        const models = await provider.listModels();
        expect(models[0].capabilities.thinking).toBe(true);
        expect(models[1].capabilities.thinking).toBe(false);
    });

    it('name 필드 누락 → displayName=id', async () => {
        const provider = makeProvider();
        injectListMock(provider, [
            { id: 'foo/bar', pricing: { prompt: '0.001', completion: '0.002' } },
        ]);
        const models = await provider.listModels();
        expect(models[0].displayName).toBe('foo/bar');
    });

    it('top_provider.max_completion_tokens 누락 → outputLimit=8000 fallback', async () => {
        const provider = makeProvider();
        injectListMock(provider, [
            { id: 'no-toplimit', pricing: { prompt: '0.001', completion: '0.002' } },
        ]);
        const models = await provider.listModels();
        expect(models[0].outputLimit).toBe(8_000);
    });

    it('SDK 호출 실패 → 빈 배열', async () => {
        const provider = makeProvider();
        const client = (provider as unknown as { client: { models: { list: jest.Mock } } }).client;
        client.models.list = jest.fn().mockRejectedValue(new Error('401 Unauthorized'));
        const models = await provider.listModels();
        expect(models).toEqual([]);
    });

    it('SDK 가 호출되어 defaultHeaders 자동 적용 (간접 검증 — list mock 호출 확인)', async () => {
        const provider = makeProvider();
        const listMock = injectListMock(provider, []);
        await provider.listModels();
        expect(listMock).toHaveBeenCalledTimes(1);
    });
});
