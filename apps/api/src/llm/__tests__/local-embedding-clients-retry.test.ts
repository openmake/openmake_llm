/**
 * text.embed 임베딩 호출처 2곳(웹검색 리랭커, 에이전트 도구 선별)은 게이트웨이 Router 재시도를 끄고(헤더) 앱에서도 재시도하지 않는다.
 * 둘 다 기한 안에 못 끝나면 건너뛰는 호출이라 재시도 이득이 없다. http-call 경계를 실제로 지나 나가는 fetch 를 본다.
 */
import { GATEWAY_NO_RETRY_HEADERS } from '../gateway-headers';

jest.mock('../../services/orchestrator/capability-resolver', () => ({
    ...jest.requireActual('../../services/orchestrator/capability-resolver'),
    resolveCapabilityTarget: async () => ({
        capability: 'text.embed', fullId: 'local-llm:emb', providerId: 'local-llm', model: 'emb',
        baseUrl: 'http://gw.test', endpoint: '/v1/embeddings', headers: {}, params: {}, source: 'global', costOwner: 'local', transport: 'gateway',
    }),
}));
jest.mock('../../services/cost/cost-ledger-service', () => ({ recordCost: jest.fn() }));

import { rerankBySemantics } from '../../tools/web-search/semantic-reranker';
import { selectRelevantToolsEmbedding, clearToolVectorCache } from '../../services/agent-task/tool-selector-embedding';

const calls: Array<{ url: string; headers: Record<string, string> }> = [];
const realFetch = global.fetch;

beforeEach(() => {
    calls.length = 0;
    clearToolVectorCache();
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
        const input = (JSON.parse(String(init?.body)) as { input: string[] }).input;
        return new Response(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [1, index] })) }), { status: 200 });
    }) as typeof fetch;
});
afterAll(() => { global.fetch = realFetch; });

function expectNoRetryCalls(n: number): void {
    expect(calls).toHaveLength(n);
    for (const c of calls) {
        expect(c.url).toBe('http://gw.test/v1/embeddings');
        expect(c.headers).toMatchObject(GATEWAY_NO_RETRY_HEADERS);
    }
}

describe('text.embed 임베딩 호출처 — 재시도 층 없음', () => {
    it('웹검색 의미 리랭커 — 한 번만 나간다', async () => {
        const results = [1, 2, 3].map((i) => ({ title: `t${i}`, url: `https://e${i}.test`, snippet: 's' }));
        await rerankBySemantics('q', results as never);
        expectNoRetryCalls(1);
    });

    it('에이전트 작업 도구 선별(임베딩 모드) — 카탈로그 1회 + goal 1회', async () => {
        const tool = { type: 'function', function: { name: 'a', description: 'd', parameters: {} } };
        await selectRelevantToolsEmbedding('goal', [tool] as never, { budget: 1 } as never);
        expectNoRetryCalls(2);
    });

    it('실패해도 다시 보내지 않는다', async () => {
        global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
            return new Response('boom', { status: 500 });
        }) as typeof fetch;
        const results = [1, 2, 3].map((i) => ({ title: `t${i}`, url: `https://e${i}.test`, snippet: 's' }));
        expect(await rerankBySemantics('q', results as never)).toBe(results);
        expectNoRetryCalls(1);
    });
});
