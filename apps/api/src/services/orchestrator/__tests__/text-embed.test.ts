const resolveMock = jest.fn();
jest.mock('../capability-resolver', () => ({
    ...jest.requireActual('../capability-resolver'),
    resolveCapabilityTarget: (...a: unknown[]) => resolveMock(...a),
}));
const callJsonMock = jest.fn();
jest.mock('../http-call', () => ({
    ...jest.requireActual('../http-call'),
    callJson: (...a: unknown[]) => callJsonMock(...a),
}));

import { resolveTextEmbed, embedTexts, clearTextEmbedKeyRejections, type TextEmbedTarget } from '../text-embed';
import { HttpCallError } from '../http-call';
import { CAPABILITY_LIMITS } from '../../../config/capabilities';
import type { CapabilityTarget } from '../capability-resolver';

const LOCAL = {
    capability: 'text.embed', fullId: 'local-llm:emb', providerId: 'local-llm', model: 'emb',
    baseUrl: 'http://gw.test', endpoint: '/v1/embeddings', headers: {}, params: {}, source: 'global', costOwner: 'local', transport: 'gateway',
} as unknown as CapabilityTarget;
const USER = { ...LOCAL, fullId: 'openai:emb', providerId: 'openai', model: 'openai/emb', costOwner: 'user', source: 'user' } as CapabilityTarget;

const te = (target: CapabilityTarget, actorUserId?: string): TextEmbedTarget => ({ target, modelKey: target.fullId, actorUserId });
const OPTS = { timeoutMs: 1000 };
const rejection = () => new HttpCallError('거절', 401, 'http', true);

beforeEach(() => {
    resolveMock.mockReset();
    callJsonMock.mockReset();
    clearTextEmbedKeyRejections();
});

describe('embedTexts — 응답 정렬·검증', () => {
    it('data[].index 가 뒤섞여 와도 입력 순서대로 돌려준다', async () => {
        callJsonMock.mockResolvedValue({ data: [{ index: 2, embedding: [3] }, { index: 0, embedding: [1] }, { index: 1, embedding: [2] }] });
        expect(await embedTexts(te(LOCAL), ['a', 'b', 'c'], OPTS)).toEqual([[1], [2], [3]]);
    });

    it('개수 부족은 throw', async () => {
        callJsonMock.mockResolvedValue({ data: [{ index: 0, embedding: [1] }] });
        await expect(embedTexts(te(LOCAL), ['a', 'b'], OPTS)).rejects.toThrow('개수');
    });

    it('빈 벡터는 throw', async () => {
        callJsonMock.mockResolvedValue({ data: [{ index: 0, embedding: [] }] });
        await expect(embedTexts(te(LOCAL), ['a'], OPTS)).rejects.toThrow('벡터');
    });

    it('기한·신호를 callJson 에 넘긴다', async () => {
        callJsonMock.mockResolvedValue({ data: [{ index: 0, embedding: [1] }] });
        const signal = new AbortController().signal;
        await embedTexts(te(LOCAL), ['a'], { timeoutMs: 1234, signal });
        expect(callJsonMock.mock.calls[0][1]).toMatchObject({ timeoutMs: 1234, signal });
    });
});

describe('embedTexts — dimensions', () => {
    it('params.dimensions 가 있으면 숫자로 싣는다', async () => {
        callJsonMock.mockResolvedValue({ data: [{ index: 0, embedding: [1] }] });
        await embedTexts(te({ ...LOCAL, params: { dimensions: '512' } }), ['a'], OPTS);
        expect(callJsonMock.mock.calls[0][1].body).toEqual({ model: 'emb', input: ['a'], dimensions: 512 });
    });

    it('없으면 싣지 않는다', async () => {
        callJsonMock.mockResolvedValue({ data: [{ index: 0, embedding: [1] }] });
        await embedTexts(te(LOCAL), ['a'], OPTS);
        expect(callJsonMock.mock.calls[0][1].body).toEqual({ model: 'emb', input: ['a'] });
    });
});

describe('embedTexts — 사용자 키 거절 메모', () => {
    afterEach(() => jest.restoreAllMocks());

    it('거절 뒤 TTL 안의 같은 사용자·공급자는 호출 없이 throw, 다른 사용자·공급자는 호출된다', async () => {
        callJsonMock.mockRejectedValueOnce(rejection());
        await expect(embedTexts(te(USER, 'u1'), ['a'], OPTS)).rejects.toMatchObject({ keyRejected: true });
        expect(callJsonMock).toHaveBeenCalledTimes(1);

        await expect(embedTexts(te(USER, 'u1'), ['a'], OPTS)).rejects.toMatchObject({ keyRejected: true });
        expect(callJsonMock).toHaveBeenCalledTimes(1);

        callJsonMock.mockResolvedValue({ data: [{ index: 0, embedding: [1] }] });
        await embedTexts(te(USER, 'u2'), ['a'], OPTS);
        await embedTexts(te({ ...USER, providerId: 'other' }, 'u1'), ['a'], OPTS);
        expect(callJsonMock).toHaveBeenCalledTimes(3);
    });

    it('TTL 뒤에는 다시 시도한다', async () => {
        const now = Date.now();
        const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
        callJsonMock.mockRejectedValueOnce(rejection());
        await expect(embedTexts(te(USER, 'u1'), ['a'], OPTS)).rejects.toThrow();
        spy.mockReturnValue(now + CAPABILITY_LIMITS.EMBED_KEY_REJECT_MEMO_MS);
        callJsonMock.mockResolvedValue({ data: [{ index: 0, embedding: [1] }] });
        await embedTexts(te(USER, 'u1'), ['a'], OPTS);
        expect(callJsonMock).toHaveBeenCalledTimes(2);
    });

    it('로컬 대상의 401 과 행위자 없는 대상은 메모하지 않는다', async () => {
        callJsonMock.mockRejectedValue(rejection());
        await expect(embedTexts(te(LOCAL, 'u1'), ['a'], OPTS)).rejects.toThrow();
        await expect(embedTexts(te(LOCAL, 'u1'), ['a'], OPTS)).rejects.toThrow();
        await expect(embedTexts(te(USER), ['a'], OPTS)).rejects.toThrow();
        await expect(embedTexts(te(USER), ['a'], OPTS)).rejects.toThrow();
        expect(callJsonMock).toHaveBeenCalledTimes(4);
    });

    it('키 거절이 아닌 실패는 메모하지 않는다', async () => {
        callJsonMock.mockRejectedValue(new HttpCallError('HTTP 500', 500));
        await expect(embedTexts(te(USER, 'u1'), ['a'], OPTS)).rejects.toThrow();
        await expect(embedTexts(te(USER, 'u1'), ['a'], OPTS)).rejects.toThrow();
        expect(callJsonMock).toHaveBeenCalledTimes(2);
    });
});

describe('resolveTextEmbed', () => {
    it('행위자로 text.embed 를 해석하고 actorUserId 를 싣는다', async () => {
        resolveMock.mockResolvedValue(LOCAL);
        const r = await resolveTextEmbed('u1');
        expect(resolveMock).toHaveBeenCalledWith('text.embed', 'u1');
        expect(r.target).toBe(LOCAL);
        expect(r.actorUserId).toBe('u1');
    });

    it('modelKey 는 fullId·dimensions 조합마다 다르다', async () => {
        const keys = new Set<string>();
        for (const t of [LOCAL, { ...LOCAL, params: { dimensions: '256' } }, { ...LOCAL, params: { dimensions: '512' } }, USER]) {
            resolveMock.mockResolvedValueOnce(t);
            keys.add((await resolveTextEmbed('u1')).modelKey);
        }
        expect(keys.size).toBe(4);
    });
});
