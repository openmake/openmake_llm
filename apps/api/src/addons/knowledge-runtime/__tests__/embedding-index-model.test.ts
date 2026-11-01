/**
 * 임베더 단위 테스트 — DB·HTTP 불필요(전부 mock).
 * - makeIndexEmbedder: 색인에 **기록된 모델**과 request_params 로, **행위자 사용자의 키**로 임베딩한다.
 *   응답 차원이 index.dimension 과 다르면 throw, 원장은 행위자에게 남긴다.
 * - 실패 분류(EmbeddingError.reason): key_missing · key_rejected(+거절 메모, 다음 호출 0) · provider
 * - describeLiveEmbedding: 배정 조회 + 키 행 검사만(복호화·공급자 호출 없음)
 * - probeDimension: 1문장 호출로 차원·게이트웨이 model 을 잰다
 */
jest.mock('../../../services/orchestrator/capability-resolver', () => {
    class CapabilityUnavailableError extends Error {
        constructor(message: string, public readonly code: string) { super(message); }
    }
    return {
        CapabilityUnavailableError,
        resolveCapabilityTargetForModel: jest.fn(),
        describeCapabilityAssignment: jest.fn(),
        checkCapabilityTargetAvailability: jest.fn(),
    };
});
jest.mock('../../../services/orchestrator/http-call', () => {
    class HttpCallError extends Error {
        constructor(message: string, public readonly status?: number, public readonly kind = 'http', public readonly keyRejected = false) { super(message); }
    }
    return { HttpCallError, callJson: jest.fn() };
});
jest.mock('../config/profiles', () => ({ getDefaultLimits: jest.fn(async () => ({ embedBatchSize: 16 })) }));
jest.mock('../../../services/cost/cost-ledger-service', () => ({ recordCost: jest.fn() }));

import {
    makeIndexEmbedder, describeLiveEmbedding, probeDimension, checkEmbeddingAvailability, classifyEmbedError, EmbeddingError,
} from '../embedding/provider';
import { clearKeyRejectionMemo } from '../embedding/key-rejection-memo';
import {
    resolveCapabilityTargetForModel, describeCapabilityAssignment, checkCapabilityTargetAvailability, CapabilityUnavailableError,
} from '../../../services/orchestrator/capability-resolver';
import { callJson, HttpCallError } from '../../../services/orchestrator/http-call';
import { recordCost } from '../../../services/cost/cost-ledger-service';

const mockForModel = resolveCapabilityTargetForModel as jest.Mock;
const mockAssignment = describeCapabilityAssignment as jest.Mock;
const mockAvailability = checkCapabilityTargetAvailability as jest.Mock;
const mockCallJson = callJson as jest.Mock;
const mockRecordCost = recordCost as jest.Mock;

/** 입력 개수만큼 dim 차원 벡터를 돌려주는 임베딩 응답 mock */
function respondDim(dim: number): void {
    mockCallJson.mockImplementation(async (_t: unknown, opts: { body: { input: string[] } }) => ({
        data: opts.body.input.map((_v, i) => ({ index: i, embedding: Array.from({ length: dim }, () => 0.1) })),
    }));
}

const localIndex = { id: 'idx-l', providerRef: 'local-llm:index-model', modelId: 'index-model', dimension: 2, requestParams: {} };
const extIndex = { id: 'idx-e', providerRef: 'gemini:emb-1', modelId: 'gemini/emb-1', dimension: 2, requestParams: { dimensions: '2' } };
const extTarget = { model: 'gemini/emb-1', providerId: 'gemini', params: { dimensions: '2' }, costOwner: 'user' };

beforeEach(() => {
    jest.clearAllMocks();
    clearKeyRejectionMemo();
    respondDim(2);
});

describe('makeIndexEmbedder', () => {
    it('색인 기록 모델·request_params·행위자 userId 로 해석하고 원장은 행위자에게', async () => {
        mockForModel.mockResolvedValue(extTarget);
        const embed = makeIndexEmbedder(extIndex, { userId: 'u1' }, { spaceId: 's1' });

        expect(await embed(['질의'])).toEqual([[0.1, 0.1]]);
        expect(mockForModel).toHaveBeenCalledWith('text.embed', 'gemini:emb-1', 'u1', {}, { dimensions: '2' });
        expect(mockRecordCost).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'u1', kind: 'search.embed', costOwner: 'byok', quantity: 1, meta: expect.objectContaining({ spaceId: 's1', indexId: 'idx-e', texts: 1 }),
        }));
        expect(mockCallJson.mock.calls[0][1].body).toMatchObject({ model: 'gemini/emb-1', dimensions: 2 });
    });

    it('응답 벡터 차원이 index.dimension 과 다르면 throw(방어적 검증)', async () => {
        mockForModel.mockResolvedValue({ model: 'index-model', params: {}, costOwner: 'local' });
        respondDim(3);
        await expect(makeIndexEmbedder(localIndex)(['질의'])).rejects.toThrow(/차원 불일치/);
    });

    it('해석된 모델이 index 기록 model 과 다르면 throw(조용한 폴백 금지)', async () => {
        mockForModel.mockResolvedValue({ model: 'other-model', params: {}, costOwner: 'local' });
        await expect(makeIndexEmbedder(localIndex)(['질의'])).rejects.toThrow(/모델 불일치/);
    });

    it('빈 입력은 호출 없이 []', async () => {
        expect(await makeIndexEmbedder(localIndex)([])).toEqual([]);
        expect(mockForModel).not.toHaveBeenCalled();
    });

    it('키 누락(해석기 KEY_MISSING·KEY_INACTIVE) → EmbeddingError key_missing, 공급자 호출 0', async () => {
        mockForModel.mockRejectedValueOnce(new CapabilityUnavailableError('키 없음', 'CAPABILITY_KEY_MISSING'));
        await expect(makeIndexEmbedder(extIndex, { userId: 'u1' })(['q'])).rejects.toMatchObject({ reason: 'key_missing' });
        mockForModel.mockRejectedValueOnce(new CapabilityUnavailableError('비활성', 'CAPABILITY_KEY_INACTIVE'));
        await expect(makeIndexEmbedder(extIndex, { userId: 'u1' })(['q'])).rejects.toBeInstanceOf(EmbeddingError);
        expect(mockCallJson).not.toHaveBeenCalled();
    });

    it('공급자 키 거절 → key_rejected + 거절 메모, TTL 안 다음 호출은 해석·호출 0', async () => {
        mockForModel.mockResolvedValue(extTarget);
        mockCallJson.mockRejectedValueOnce(new HttpCallError('401', 401, 'http', true));
        await expect(makeIndexEmbedder(extIndex, { userId: 'u1' })(['q'])).rejects.toMatchObject({ reason: 'key_rejected' });

        mockForModel.mockClear();
        mockCallJson.mockClear();
        await expect(makeIndexEmbedder(extIndex, { userId: 'u1' })(['q'])).rejects.toMatchObject({ reason: 'key_rejected' });
        expect(mockForModel).not.toHaveBeenCalled();
        expect(mockCallJson).not.toHaveBeenCalled();
        // 다른 사용자는 메모 영향 없음
        await makeIndexEmbedder(extIndex, { userId: 'u2' })(['q']);
        expect(mockCallJson).toHaveBeenCalledTimes(1);
    });

    it('429·5xx(키 거절 아님)는 provider — 메모하지 않는다', async () => {
        mockForModel.mockResolvedValue(extTarget);
        mockCallJson.mockRejectedValueOnce(new HttpCallError('429', 429));
        const err = await makeIndexEmbedder(extIndex, { userId: 'u1' })(['q']).catch((e) => e);
        expect(classifyEmbedError(err)).toBe('provider');
        await makeIndexEmbedder(extIndex, { userId: 'u1' })(['q']);
        expect(mockCallJson).toHaveBeenCalledTimes(2);
    });

    it('로컬(서버 키) 401 은 사용자 키 문제가 아니라 provider', async () => {
        mockForModel.mockResolvedValue({ model: 'index-model', providerId: 'local-llm', params: {}, costOwner: 'local' });
        mockCallJson.mockRejectedValueOnce(new HttpCallError('401', 401, 'http', true));
        const err = await makeIndexEmbedder(localIndex, { userId: 'u1' })(['q']).catch((e) => e);
        expect(classifyEmbedError(err)).toBe('provider');
    });
});

describe('describeLiveEmbedding · checkEmbeddingAvailability', () => {
    it('배정 + 키 행 검사 ok → live, 공급자 호출·차원 측정 없음', async () => {
        mockAssignment.mockResolvedValue({ fullId: 'gemini:emb-1', providerId: 'gemini', model: 'gemini/emb-1', params: {}, source: 'global' });
        mockAvailability.mockResolvedValue({ ok: true });
        expect(await describeLiveEmbedding('u1')).toEqual({
            live: { fullId: 'gemini:emb-1', providerId: 'gemini', model: 'gemini/emb-1', params: {}, source: 'global' }, failure: null,
        });
        expect(mockAvailability).toHaveBeenCalledWith('text.embed', 'gemini:emb-1', 'u1');
        expect(mockCallJson).not.toHaveBeenCalled();
    });

    it('미배정 → live null + unassigned, 키 없음 → live 유지 + key_missing', async () => {
        mockAssignment.mockResolvedValueOnce(null);
        expect(await describeLiveEmbedding('u1')).toMatchObject({ live: null, failure: { reason: 'unassigned' } });
        mockAssignment.mockResolvedValueOnce({ fullId: 'gemini:emb-1', providerId: 'gemini', model: 'gemini/emb-1', params: {}, source: 'user' });
        mockAvailability.mockResolvedValueOnce({ ok: false, code: 'CAPABILITY_KEY_MISSING', message: '키 없음' });
        expect(await describeLiveEmbedding('u1')).toMatchObject({ live: { fullId: 'gemini:emb-1' }, failure: { reason: 'key_missing', message: '키 없음' } });
    });

    it('거절 메모에 있으면 키 행이 멀쩡해도 key_rejected', async () => {
        mockForModel.mockResolvedValue(extTarget);
        mockCallJson.mockRejectedValueOnce(new HttpCallError('401', 401, 'http', true));
        await makeIndexEmbedder(extIndex, { userId: 'u1' })(['q']).catch(() => undefined);
        mockAvailability.mockResolvedValue({ ok: true });
        expect(await checkEmbeddingAvailability('gemini:emb-1', 'u1')).toMatchObject({ ok: false, reason: 'key_rejected' });
        expect(await checkEmbeddingAvailability('gemini:emb-1', 'u2')).toEqual({ ok: true });
    });
});

describe('probeDimension', () => {
    it('라이브 params 로 1회 호출해 차원과 게이트웨이 model 을 돌려준다', async () => {
        mockForModel.mockResolvedValue(extTarget);
        respondDim(3);
        const live = { fullId: 'gemini:emb-1', providerId: 'gemini', model: 'gemini/emb-1', params: { dimensions: '3' }, source: 'user' as const };
        expect(await probeDimension(live, { userId: 'u1' })).toEqual({ dimension: 3, model: 'gemini/emb-1' });
        expect(mockForModel).toHaveBeenCalledWith('text.embed', 'gemini:emb-1', 'u1', {}, { dimensions: '3' });
        expect(mockCallJson).toHaveBeenCalledTimes(1);
    });

    it('키 거절이면 key_rejected', async () => {
        mockForModel.mockResolvedValue(extTarget);
        mockCallJson.mockRejectedValueOnce(new HttpCallError('401', 401, 'http', true));
        const live = { fullId: 'gemini:emb-1', providerId: 'gemini', model: 'gemini/emb-1', params: {}, source: 'user' as const };
        await expect(probeDimension(live, { userId: 'u1' })).rejects.toMatchObject({ reason: 'key_rejected' });
    });
});
