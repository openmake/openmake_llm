/**
 * 웹검색 의미 리랭킹은 text.embed capability 배정으로 임베딩한다 — env 기본값(bge-m3)을 부르지 않는다.
 * 경계 두 곳(capability-resolver·http-call)만 가로챈다.
 */
const sdkModels: string[] = [];
jest.mock('openai', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
        embeddings: { create: async ({ model, input }: { model: string; input: string[] }) => {
            sdkModels.push(model);
            return { data: input.map(() => ({ embedding: [1, 0] })) };
        } },
    })),
}));
const resolveMock = jest.fn();
jest.mock('../../../services/orchestrator/capability-resolver', () => ({
    ...jest.requireActual('../../../services/orchestrator/capability-resolver'),
    resolveCapabilityTarget: (...a: unknown[]) => resolveMock(...a),
}));
const callJsonMock = jest.fn();
jest.mock('../../../services/orchestrator/http-call', () => ({
    ...jest.requireActual('../../../services/orchestrator/http-call'),
    callJson: (...a: unknown[]) => callJsonMock(...a),
}));
const recordCostMock = jest.fn();
jest.mock('../../../services/cost/cost-ledger-service', () => ({ recordCost: (...a: unknown[]) => recordCostMock(...a) }));

import { rerankBySemantics, logSemanticRerankShadow } from '../semantic-reranker';
import { CapabilityUnavailableError } from '../../../services/orchestrator/capability-resolver';
import { HttpCallError } from '../../../services/orchestrator/http-call';
import { clearTextEmbedKeyRejections } from '../../../services/orchestrator/text-embed';
import type { SearchResult } from '../types';

const TARGET = {
    capability: 'text.embed', fullId: 'local-llm:assigned-embed', providerId: 'local-llm', model: 'assigned-embed',
    baseUrl: 'http://gw.test', endpoint: '/v1/embeddings', headers: {}, params: {}, source: 'global', costOwner: 'local', transport: 'gateway',
};
const USER_TARGET = { ...TARGET, fullId: 'openai:emb', providerId: 'openai', model: 'openai/emb', costOwner: 'user', source: 'user' };

const results = (n: number): SearchResult[] =>
    Array.from({ length: n }, (_, i) => ({ title: `t${i}`, url: `https://e${i}.test`, snippet: 's' }) as SearchResult);

/** 질의는 [1,0], i 번째 소스는 유사도가 i 에 비례해 커지는 벡터 → 역순으로 재정렬된다 */
function rankingEmbed() {
    return async (_t: unknown, o: { body: { input: string[] } }) => ({
        data: o.body.input.map((_, index) => ({ index, embedding: index === 0 ? [1, 0] : [index, 100 - index] })),
    });
}

beforeEach(() => {
    sdkModels.length = 0;
    resolveMock.mockReset();
    callJsonMock.mockReset();
    recordCostMock.mockReset();
    clearTextEmbedKeyRejections();
});

it('배정된 text.embed 모델로 임베딩해 유사도 순으로 재정렬한다 — bge-m3 를 부르지 않는다', async () => {
    resolveMock.mockResolvedValue(TARGET);
    callJsonMock.mockImplementation(rankingEmbed());
    const input = results(3);

    const out = await rerankBySemantics('q', input, 'u1');

    expect(sdkModels).toEqual([]);
    expect(resolveMock).toHaveBeenCalledWith('text.embed', 'u1');
    expect(callJsonMock).toHaveBeenCalledTimes(1);
    expect(callJsonMock.mock.calls[0][0]).toBe(TARGET);
    expect(callJsonMock.mock.calls[0][1].body.model).toBe('assigned-embed');
    expect(out.map((r) => r.url)).toEqual(['https://e2.test', 'https://e1.test', 'https://e0.test']);
    expect(recordCostMock).toHaveBeenCalledTimes(1);
    expect(recordCostMock.mock.calls[0][0]).toMatchObject({ kind: 'search.rerank', rateKey: 'assigned-embed', costOwner: 'user', quantity: 1 });
});

it('사용자 키 대상이면 원장 costOwner byok', async () => {
    resolveMock.mockResolvedValue(USER_TARGET);
    callJsonMock.mockImplementation(rankingEmbed());
    await rerankBySemantics('q', results(3), 'u1');
    expect(recordCostMock.mock.calls[0][0]).toMatchObject({ rateKey: 'openai/emb', costOwner: 'byok' });
});

it.each([
    ['미배정', () => resolveMock.mockRejectedValue(new CapabilityUnavailableError('x', 'CAPABILITY_UNASSIGNED'))],
    ['키 없음', () => resolveMock.mockRejectedValue(new CapabilityUnavailableError('x', 'CAPABILITY_KEY_MISSING'))],
    ['호출 실패', () => { resolveMock.mockResolvedValue(TARGET); callJsonMock.mockRejectedValue(new HttpCallError('HTTP 500', 500)); }],
])('%s → 입력 그대로, 원장 없음', async (_n, setup) => {
    setup();
    const input = results(4);
    expect(await rerankBySemantics('q', input, 'u1')).toBe(input);
    expect(recordCostMock).not.toHaveBeenCalled();
});

it('13번째 이후 결과는 순서를 유지한다', async () => {
    resolveMock.mockResolvedValue(TARGET);
    callJsonMock.mockImplementation(rankingEmbed());
    const input = results(15);
    const out = await rerankBySemantics('q', input, 'u1');
    expect(callJsonMock.mock.calls[0][1].body.input).toHaveLength(13);
    expect(out.slice(12).map((r) => r.url)).toEqual(['https://e12.test', 'https://e13.test', 'https://e14.test']);
    expect(out.slice(0, 12).map((r) => r.url)[0]).toBe('https://e11.test');
});

it('결과가 3건 미만이면 해석도 하지 않는다', async () => {
    const input = results(2);
    expect(await rerankBySemantics('q', input, 'u1')).toBe(input);
    await logSemanticRerankShadow('q', input, 'u1');
    expect(resolveMock).not.toHaveBeenCalled();
});

it('셰도우: 실패를 삼키고, 성공하면 원장 1건', async () => {
    resolveMock.mockResolvedValue(TARGET);
    callJsonMock.mockRejectedValue(new HttpCallError('HTTP 500', 500));
    await expect(logSemanticRerankShadow('q', results(3), 'u1')).resolves.toBeUndefined();
    expect(recordCostMock).not.toHaveBeenCalled();

    resolveMock.mockRejectedValue(new CapabilityUnavailableError('x', 'CAPABILITY_UNASSIGNED'));
    await expect(logSemanticRerankShadow('q', results(3), 'u1')).resolves.toBeUndefined();

    resolveMock.mockResolvedValue(TARGET);
    callJsonMock.mockImplementation(rankingEmbed());
    await logSemanticRerankShadow('q', results(3), 'u1');
    expect(recordCostMock).toHaveBeenCalledTimes(1);
    expect(recordCostMock.mock.calls[0][0]).toMatchObject({ kind: 'search.rerank', rateKey: 'assigned-embed' });
});

it('사용자 키 거절 뒤 같은 사용자의 재호출은 공급자를 다시 부르지 않는다', async () => {
    resolveMock.mockResolvedValue(USER_TARGET);
    callJsonMock.mockRejectedValue(new HttpCallError('거절', 401, 'http', true));
    const input = results(3);
    expect(await rerankBySemantics('q', input, 'u1')).toBe(input);
    expect(callJsonMock).toHaveBeenCalledTimes(1);
    expect(await rerankBySemantics('q', input, 'u1')).toBe(input);
    expect(callJsonMock).toHaveBeenCalledTimes(1);
    // 다른 사용자는 호출된다
    await rerankBySemantics('q', input, 'u2');
    expect(callJsonMock).toHaveBeenCalledTimes(2);
});

describe('리랭킹 기한(SEARCH_RERANK_TIMEOUT_MS 기본 2500) — 해석부터 임베딩까지 하나로 덮는다 (2026-11-18 r4, Fable r3 지적 3)', () => {
    afterEach(() => jest.useRealTimers());

    it('embedTexts 에 기한과 공유 신호를 넘긴다', async () => {
        resolveMock.mockResolvedValue(TARGET);
        callJsonMock.mockImplementation(rankingEmbed());
        await rerankBySemantics('q', results(3), 'u1');
        const opts = callJsonMock.mock.calls[0][1] as { timeoutMs: number; signal?: AbortSignal };
        expect(opts.timeoutMs).toBe(2500);
        expect(opts.signal).toBeInstanceOf(AbortSignal);
        expect(opts.signal!.aborted).toBe(false);
    });

    it('해석이 기한을 넘기면 기존 랭킹을 돌려주고, 늦게 끝난 해석 뒤에도 호출·원장이 없다', async () => {
        jest.useFakeTimers();
        let finishResolve!: (v: unknown) => void;
        resolveMock.mockReturnValue(new Promise((r) => { finishResolve = r; }));
        callJsonMock.mockImplementation(rankingEmbed());
        const input = results(3);

        const p = rerankBySemantics('q', input, 'u1');
        await jest.advanceTimersByTimeAsync(2500);
        await expect(p).resolves.toBe(input);

        finishResolve(TARGET);
        await jest.advanceTimersByTimeAsync(0);
        expect(callJsonMock).not.toHaveBeenCalled();
        expect(recordCostMock).not.toHaveBeenCalled();
    });

    it('해석 2000ms + 임베딩이 남은 500ms 를 넘기면 2500ms 에 끊고 기존 랭킹을 돌려준다', async () => {
        jest.useFakeTimers();
        resolveMock.mockImplementation(() => new Promise((r) => setTimeout(() => r(TARGET), 2000)));
        let seen: AbortSignal | undefined;
        callJsonMock.mockImplementation((_t: unknown, o: { signal?: AbortSignal }) => new Promise((_, rej) => {
            seen = o.signal;
            o.signal?.addEventListener('abort', () => rej(new Error('aborted')));
        }));
        const input = results(3);

        let settled = false;
        const p = rerankBySemantics('q', input, 'u1').finally(() => { settled = true; });
        await jest.advanceTimersByTimeAsync(2000);
        expect(callJsonMock).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(499);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        await expect(p).resolves.toBe(input);
        expect(seen?.aborted).toBe(true);
        expect(recordCostMock).not.toHaveBeenCalled();
    });
});
