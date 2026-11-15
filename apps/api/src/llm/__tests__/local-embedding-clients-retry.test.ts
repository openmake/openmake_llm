/**
 * 로컬 주소로 가는 임베딩 클라이언트 2곳(웹검색 리랭커, 에이전트 도구 선별)은 게이트웨이 Router 재시도 헤더 + 앱 SDK 재시도 0 이다.
 * 둘 다 기한을 Promise.race 로만 걸고 실패하면 건너뛰는 호출이라 재시도 이득이 없고, 호출자가 포기한 뒤에도 SDK 재시도가 뒤에서 돈다.
 */
import { GATEWAY_NO_RETRY_HEADERS } from '../gateway-headers';

const ctorArgs: Array<Record<string, unknown>> = [];
jest.mock('openai', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation((opts: Record<string, unknown>) => {
        ctorArgs.push(opts);
        return { embeddings: { create: async ({ input }: { input: string[] }) => ({ data: input.map((_, i) => ({ embedding: [1, i] })) }) } };
    }),
}));
jest.mock('../../config/env', () => ({
    getConfig: () => ({ llmBaseUrl: 'http://gw.test/v1', llmApiKey: 'k', searchRerankEmbedModel: 'emb' }),
}));
jest.mock('../../services/cost/cost-ledger-service', () => ({ recordCost: jest.fn() }));

import { rerankBySemantics } from '../../tools/web-search/semantic-reranker';
import { selectRelevantToolsEmbedding } from '../../services/agent-task/tool-selector-embedding';

beforeEach(() => { ctorArgs.length = 0; });

function expectNoRetryClients(): void {
    expect(ctorArgs.length).toBeGreaterThan(0);
    for (const opts of ctorArgs) {
        expect(opts.maxRetries).toBe(0);
        expect(opts.defaultHeaders).toEqual(GATEWAY_NO_RETRY_HEADERS);
    }
}

describe('로컬 임베딩 클라이언트 — 재시도 층 없음', () => {
    it('웹검색 의미 리랭커', async () => {
        // 리랭커는 기한 타이머(2.5초)를 Promise.race 로 걸고 치우지 않는다 — 가짜 타이머로 받아 테스트 끝에 버린다.
        jest.useFakeTimers();
        try {
            const results = [1, 2, 3].map((i) => ({ title: `t${i}`, url: `https://e${i}.test`, snippet: 's' }));
            await rerankBySemantics('q', results as never);
            expectNoRetryClients();
        } finally {
            jest.clearAllTimers();
            jest.useRealTimers();
        }
    });

    it('에이전트 작업 도구 선별(임베딩 모드)', async () => {
        const tool = { type: 'function', function: { name: 'a', description: 'd', parameters: {} } };
        await selectRelevantToolsEmbedding('goal', [tool] as never, { budget: 1 } as never);
        expectNoRetryClients();
    });
});
