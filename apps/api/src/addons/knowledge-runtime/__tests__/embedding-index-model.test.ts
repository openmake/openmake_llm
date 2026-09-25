/**
 * makeIndexEmbedder 단위 테스트 — DB·HTTP 불필요(전부 mock).
 * 활성 index 는 라이브 `text.embed` 배정이 바뀌어도 **index 에 기록된 모델**로만 임베딩하고,
 * 응답 차원이 index.dimension 과 다르면 throw 함을 검증한다.
 */
jest.mock('../../../services/orchestrator/capability-resolver', () => ({
    resolveCapabilityTargetForModel: jest.fn(),
    resolveCapabilityTarget: jest.fn(),
}));
jest.mock('../../../services/orchestrator/http-call', () => ({ callJson: jest.fn() }));
jest.mock('../config/profiles', () => ({ getDefaultLimits: jest.fn(async () => ({ embedBatchSize: 16 })) }));
jest.mock('../../../services/cost/cost-ledger-service', () => ({ recordCost: jest.fn() }));

import { makeIndexEmbedder, embedTexts, clearEmbeddingProviderCache } from '../embedding/provider';
import { resolveCapabilityTargetForModel, resolveCapabilityTarget } from '../../../services/orchestrator/capability-resolver';
import { callJson } from '../../../services/orchestrator/http-call';

const mockForModel = resolveCapabilityTargetForModel as jest.Mock;
const mockLive = resolveCapabilityTarget as jest.Mock;
const mockCallJson = callJson as jest.Mock;

/** 입력 개수만큼 dim 차원 벡터를 돌려주는 임베딩 응답 mock */
function respondDim(dim: number): void {
    mockCallJson.mockImplementation(async (_t: unknown, opts: { body: { input: string[] } }) => ({
        data: opts.body.input.map((_v, i) => ({ index: i, embedding: Array.from({ length: dim }, () => 0.1) })),
    }));
}

describe('makeIndexEmbedder', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearEmbeddingProviderCache();
        respondDim(2);
    });

    it('배정이 바뀌어도 index 에 기록된 provider_ref/model 로 임베딩한다(라이브 배정 해석 안 함)', async () => {
        mockForModel.mockResolvedValue({ model: 'index-model', params: {} });
        const embed = makeIndexEmbedder({ providerRef: 'local-llm:index-model', modelId: 'index-model', dimension: 2 });

        const out = await embed(['질의']);

        expect(out).toEqual([[0.1, 0.1]]);
        expect(mockForModel).toHaveBeenCalledWith('text.embed', 'local-llm:index-model');
        expect(mockLive).not.toHaveBeenCalled();
    });

    it('응답 벡터 차원이 index.dimension 과 다르면 throw(방어적 검증)', async () => {
        mockForModel.mockResolvedValue({ model: 'index-model', params: {} });
        respondDim(3); // index 는 2 인데 3 이 왔다
        const embed = makeIndexEmbedder({ providerRef: 'local-llm:index-model', modelId: 'index-model', dimension: 2 });

        await expect(embed(['질의'])).rejects.toThrow(/차원 불일치/);
    });

    it('해석된 모델이 index 기록 model 과 다르면 throw(조용한 폴백 금지)', async () => {
        mockForModel.mockResolvedValue({ model: 'other-model', params: {} });
        const embed = makeIndexEmbedder({ providerRef: 'local-llm:index-model', modelId: 'index-model', dimension: 2 });

        await expect(embed(['질의'])).rejects.toThrow(/모델 불일치/);
    });

    it('빈 입력은 호출 없이 [] (index 경로)', async () => {
        const embed = makeIndexEmbedder({ providerRef: 'local-llm:index-model', modelId: 'index-model', dimension: 2 });
        expect(await embed([])).toEqual([]);
        expect(mockForModel).not.toHaveBeenCalled();
    });
});

describe('embedTexts (라이브 배정)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearEmbeddingProviderCache();
        respondDim(2);
    });

    it('라이브 text.embed 배정을 해석한다 — index 경로와 분리되어 있다', async () => {
        mockLive.mockResolvedValue({ model: 'live-model', params: {} });

        const out = await embedTexts(['질의']);

        expect(out).toEqual([[0.1, 0.1]]);
        expect(mockLive).toHaveBeenCalledWith('text.embed');
        expect(mockForModel).not.toHaveBeenCalled();
    });
});
