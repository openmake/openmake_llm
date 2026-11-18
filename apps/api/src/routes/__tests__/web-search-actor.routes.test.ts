/**
 * POST /api/web-search — 인증 사용자를 costUserId 로 넘긴다 (2026-11-18 r4, Fable r3 지적 1).
 * 넘기지 않으면 의미 리랭킹이 행위자 없이 해석돼 개인 text.embed 배정만 있는 사용자는 '미배정' 으로 skip 된다.
 */
const performWebSearch = jest.fn(async (_q: string, _o?: unknown) => [] as unknown[]);
jest.mock('../../tools/web-search', () => ({ performWebSearch: (q: string, o?: unknown) => performWebSearch(q, o) }));
jest.mock('../../auth', () => ({ requireAuth: (_r: unknown, _s: unknown, n: () => void) => n() }));
jest.mock('../../chat/profile-resolver', () => ({ buildExecutionPlan: () => ({ resolvedEngine: 'local-model' }) }));

import router from '../web-search.routes';

interface Layer { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: unknown, res: unknown, next: (e?: unknown) => void) => unknown }> } }

async function post(user: { id: number | string } | undefined) {
    const layer = (router as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === '/web-search' && l.route.methods.post);
    if (!layer?.route) throw new Error('route not found');
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    // 클러스터 미초기화 → 검색 뒤 503 으로 끝난다. 검색 호출 인자만 본다.
    await new Promise<void>((resolve, reject) => {
        const res = { json: () => resolve(), status: () => res };
        void handler({ body: { query: '질의' }, user }, res, (e) => reject(e ?? new Error('next()')));
    });
}

describe('POST /api/web-search — 행위자 전달', () => {
    beforeEach(() => performWebSearch.mockClear());

    it('인증 사용자 id 를 문자열 costUserId 로 넘긴다', async () => {
        await post({ id: 7 });
        expect(performWebSearch).toHaveBeenCalledTimes(1);
        expect(performWebSearch.mock.calls[0][1]).toEqual(expect.objectContaining({ maxResults: 5, costUserId: '7' }));
    });
});
