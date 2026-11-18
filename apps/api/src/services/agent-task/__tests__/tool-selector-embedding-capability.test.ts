/**
 * 도구 선별(임베딩 모드)은 text.embed capability 배정으로 임베딩한다 — env 기본값(bge-m3)을 부르지 않는다.
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
jest.mock('../../orchestrator/capability-resolver', () => ({
    ...jest.requireActual('../../orchestrator/capability-resolver'),
    resolveCapabilityTarget: (...a: unknown[]) => resolveMock(...a),
}));
const callJsonMock = jest.fn();
jest.mock('../../orchestrator/http-call', () => ({
    ...jest.requireActual('../../orchestrator/http-call'),
    callJson: (...a: unknown[]) => callJsonMock(...a),
}));
const recordCostMock = jest.fn();
jest.mock('../../cost/cost-ledger-service', () => ({ recordCost: (...a: unknown[]) => recordCostMock(...a) }));

import { selectRelevantToolsEmbedding, clearToolVectorCache } from '../tool-selector-embedding';
import { selectRelevantTools } from '../tool-selector';
import { CapabilityUnavailableError } from '../../orchestrator/capability-resolver';
import { HttpCallError } from '../../orchestrator/http-call';
import { clearTextEmbedKeyRejections } from '../../orchestrator/text-embed';
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';

const TARGET = {
    capability: 'text.embed', fullId: 'local-llm:assigned-embed', providerId: 'local-llm', model: 'assigned-embed',
    baseUrl: 'http://gw.test', endpoint: '/v1/embeddings', headers: {}, params: {}, source: 'global', costOwner: 'local', transport: 'gateway',
};
const tool = (name: string) => ({ type: 'function', function: { name, description: `${name} 설명`, parameters: {} } });

/** 모든 입력에 같은 방향 벡터(dim 차원)를 돌려준다 */
function okEmbed(dim = 2) {
    return async (_t: unknown, o: { body: { input: string[] } }) => ({
        data: o.body.input.map((_, index) => ({ index, embedding: [1, ...new Array(dim - 1).fill(0)] })),
    });
}

beforeEach(() => {
    sdkModels.length = 0;
    resolveMock.mockReset();
    callJsonMock.mockReset();
    recordCostMock.mockReset();
    clearToolVectorCache();
    clearTextEmbedKeyRejections();
});

it('배정된 text.embed 모델로 임베딩한다 — env 기본값 bge-m3 를 부르지 않는다', async () => {
    resolveMock.mockResolvedValue(TARGET);
    callJsonMock.mockImplementation(okEmbed());

    const picked = await selectRelevantToolsEmbedding('일정 잡아줘', [tool('calendar_create')] as never, { budget: 1, costUserId: 'u1' });

    expect(sdkModels).toEqual([]);
    expect(resolveMock).toHaveBeenCalledWith('text.embed', 'u1');
    expect(callJsonMock.mock.calls.every(([t, o]) => t === TARGET && o.body.model === 'assigned-embed')).toBe(true);
    expect(picked.map((t) => t.function.name)).toEqual(['calendar_create']);
});

it('미배정이면 callJson 없이 키워드 폴백과 같은 결과', async () => {
    resolveMock.mockRejectedValue(new CapabilityUnavailableError('미배정', 'CAPABILITY_UNASSIGNED'));
    const catalog = [tool('calendar_create'), tool('web_search')] as never;
    const opts = { budget: 2, costUserId: 'u1' };
    const picked = await selectRelevantToolsEmbedding('calendar 일정', catalog, opts);
    expect(callJsonMock).not.toHaveBeenCalled();
    expect(picked).toEqual(selectRelevantTools('calendar 일정', catalog, opts));
});

it('costUserId 없으면 행위자 없이 해석한다', async () => {
    resolveMock.mockResolvedValue(TARGET);
    callJsonMock.mockImplementation(okEmbed());
    await selectRelevantToolsEmbedding('g', [tool('a')] as never, { budget: 1 });
    expect(resolveMock).toHaveBeenCalledWith('text.embed', undefined);
    expect(recordCostMock).not.toHaveBeenCalled();
});

it('모델별 캐시 분리 — 차원이 다른 모델이 섞여도 결과가 비지 않는다', async () => {
    const X = { ...TARGET, fullId: 'local-llm:x', model: 'x' };
    const Y = { ...TARGET, fullId: 'local-llm:y', model: 'y', params: { dimensions: '3' } };
    resolveMock.mockImplementation(async (_c: string, u?: string) => (u === 'A' ? X : Y));
    callJsonMock.mockImplementation(async (t: { model: string }, o: { body: { input: string[] } }) =>
        okEmbed(t.model === 'x' ? 2 : 3)(t, o));
    const catalog = [tool('a'), tool('b')] as never;

    expect(await selectRelevantToolsEmbedding('g', catalog, { budget: 2, costUserId: 'A' })).toHaveLength(2);
    expect(await selectRelevantToolsEmbedding('g', catalog, { budget: 2, costUserId: 'B' })).toHaveLength(2);
    // 카탈로그 1회 + goal 1회 씩
    expect(callJsonMock).toHaveBeenCalledTimes(4);
    callJsonMock.mockClear();
    await selectRelevantToolsEmbedding('g', catalog, { budget: 2, costUserId: 'A' });
    expect(callJsonMock).toHaveBeenCalledTimes(1); // goal 만
    expect(callJsonMock.mock.calls[0][1].body.input).toEqual(['g']);
});

it('모델 키 상한을 넘으면 가장 오래된 키가 지워진다', async () => {
    const limit = AGENT_TASK_LIMITS.DYNAMIC_TOOLS_EMBED_CACHE_MODELS;
    const targets = Array.from({ length: limit + 1 }, (_, i) => ({ ...TARGET, fullId: `local-llm:m${i}`, model: `m${i}` }));
    resolveMock.mockImplementation(async (_c: string, u?: string) => targets[Number(u)]);
    callJsonMock.mockImplementation(okEmbed());
    for (let i = 0; i <= limit; i++) await selectRelevantToolsEmbedding('g', [tool('a')] as never, { budget: 1, costUserId: String(i) });
    callJsonMock.mockClear();
    // 마지막 키는 남아 있다 — goal 만
    await selectRelevantToolsEmbedding('g', [tool('a')] as never, { budget: 1, costUserId: String(limit) });
    expect(callJsonMock).toHaveBeenCalledTimes(1);
    callJsonMock.mockClear();
    // 첫 키는 밀려났다 — 카탈로그 재임베딩 + goal
    await selectRelevantToolsEmbedding('g', [tool('a')] as never, { budget: 1, costUserId: '0' });
    expect(callJsonMock).toHaveBeenCalledTimes(2);
});

it('임베딩 호출 실패 → 키워드 폴백', async () => {
    resolveMock.mockResolvedValue(TARGET);
    callJsonMock.mockRejectedValue(new HttpCallError('HTTP 500', 500));
    const catalog = [tool('calendar_create')] as never;
    const opts = { budget: 1, costUserId: 'u1' };
    expect(await selectRelevantToolsEmbedding('calendar', catalog, opts)).toEqual(selectRelevantTools('calendar', catalog, opts));
});

it('기한 초과 → 진행 중 호출이 실제로 끊기고, 이미 성공한 호출만 원장에 1회 기록, 키워드 폴백', async () => {
    const restore = jest.replaceProperty(AGENT_TASK_LIMITS, 'DYNAMIC_TOOLS_EMBED_TIMEOUT_MS', 50);
    try {
        resolveMock.mockResolvedValue(TARGET);
        let aborted!: () => void;
        const abortedP = new Promise<void>((r) => { aborted = r; });
        const ok = okEmbed();
        // 첫 호출(카탈로그 배치)은 성공, 둘째 호출(goal)은 신호가 끊을 때까지 걸려 있다.
        callJsonMock
            .mockImplementationOnce(ok)
            .mockImplementationOnce((_t: unknown, o: { signal?: AbortSignal }) => new Promise((_, rej) => {
                o.signal?.addEventListener('abort', () => { aborted(); rej(new Error('aborted')); });
            }));
        const catalog = [tool('calendar_create')] as never;
        const opts = { budget: 1, costUserId: 'u1' };

        expect(await selectRelevantToolsEmbedding('calendar', catalog, opts)).toEqual(selectRelevantTools('calendar', catalog, opts));
        // 신호가 전달되지 않으면 둘째 호출은 끊기지 않는다 — 기다림 상한 안에 abort 가 와야 한다.
        const wasAborted = await Promise.race([abortedP.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 1000).unref())]);
        expect(wasAborted).toBe(true);
        await new Promise((r) => setImmediate(r));
        expect(callJsonMock).toHaveBeenCalledTimes(2);
        expect(recordCostMock).toHaveBeenCalledTimes(1);
        expect(recordCostMock.mock.calls[0][0]).toMatchObject({ userId: 'u1', kind: 'search.embed', quantity: 1 });
    } finally {
        restore.restore();
    }
});

it('원장: rateKey 는 해석된 model, 사용자 키 대상이면 byok, quantity 는 호출 수', async () => {
    resolveMock.mockResolvedValue({ ...TARGET, fullId: 'openai:emb', providerId: 'openai', model: 'openai/emb', costOwner: 'user', source: 'user' });
    callJsonMock.mockImplementation(okEmbed());
    await selectRelevantToolsEmbedding('g', [tool('a')] as never, { budget: 1, costUserId: 'u1' });
    expect(recordCostMock).toHaveBeenCalledTimes(1);
    expect(recordCostMock.mock.calls[0][0]).toMatchObject({ userId: 'u1', kind: 'search.embed', rateKey: 'openai/emb', costOwner: 'byok', quantity: 2 });
});

it('원장: 로컬 대상은 costOwner user 유지', async () => {
    resolveMock.mockResolvedValue(TARGET);
    callJsonMock.mockImplementation(okEmbed());
    await selectRelevantToolsEmbedding('g', [tool('a')] as never, { budget: 1, costUserId: 'u1' });
    expect(recordCostMock.mock.calls[0][0]).toMatchObject({ rateKey: 'assigned-embed', costOwner: 'user', quantity: 2 });
});

describe('부분 성공 원장', () => {
    const catalog = Array.from({ length: 65 }, (_, i) => tool(`t${i}`)) as never;

    it('첫 배치 성공·둘째 배치 실패 → 폴백, quantity 1 로 한 번', async () => {
        resolveMock.mockResolvedValue(TARGET);
        let n = 0;
        callJsonMock.mockImplementation(async (t: unknown, o: { body: { input: string[] } }) => {
            if (n++ === 0) return okEmbed()(t, o);
            throw new HttpCallError('HTTP 500', 500);
        });
        const opts = { budget: 3, costUserId: 'u1' };
        expect(await selectRelevantToolsEmbedding('t1', catalog, opts)).toEqual(selectRelevantTools('t1', catalog, opts));
        expect(recordCostMock).toHaveBeenCalledTimes(1);
        expect(recordCostMock.mock.calls[0][0]).toMatchObject({ quantity: 1 });
    });

    it('첫 호출부터 실패 → 원장 없음', async () => {
        resolveMock.mockResolvedValue(TARGET);
        callJsonMock.mockRejectedValue(new HttpCallError('HTTP 500', 500));
        await selectRelevantToolsEmbedding('t1', catalog, { budget: 3, costUserId: 'u1' });
        expect(recordCostMock).not.toHaveBeenCalled();
    });

    it('배치는 다 성공, goal 실패 → quantity = 배치 수', async () => {
        resolveMock.mockResolvedValue(TARGET);
        callJsonMock.mockImplementation(async (t: unknown, o: { body: { input: string[] } }) => {
            if (o.body.input.length === 1 && o.body.input[0] === 't1') throw new HttpCallError('HTTP 500', 500);
            return okEmbed()(t, o);
        });
        await selectRelevantToolsEmbedding('t1', catalog, { budget: 3, costUserId: 'u1' });
        expect(recordCostMock).toHaveBeenCalledTimes(1);
        expect(recordCostMock.mock.calls[0][0]).toMatchObject({ quantity: 2 });
    });
});

it('사용자 키 거절 뒤 같은 사용자의 재선별은 공급자를 다시 부르지 않는다', async () => {
    resolveMock.mockResolvedValue({ ...TARGET, fullId: 'openai:emb', providerId: 'openai', model: 'openai/emb', costOwner: 'user', source: 'user' });
    callJsonMock.mockRejectedValue(new HttpCallError('거절', 401, 'http', true));
    const catalog = [tool('calendar_create')] as never;
    const opts = { budget: 1, costUserId: 'u1' };
    expect(await selectRelevantToolsEmbedding('calendar', catalog, opts)).toEqual(selectRelevantTools('calendar', catalog, opts));
    expect(callJsonMock).toHaveBeenCalledTimes(1);
    expect(await selectRelevantToolsEmbedding('calendar', catalog, opts)).toEqual(selectRelevantTools('calendar', catalog, opts));
    expect(callJsonMock).toHaveBeenCalledTimes(1);
});
