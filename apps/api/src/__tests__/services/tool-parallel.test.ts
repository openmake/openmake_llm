/**
 * 턴 내 읽기 전용 도구 병렬 선실행 — 계약 고정.
 *
 * 핵심은 ① 읽기 전용 목록 밖은 절대 병렬하지 않는다 ② 결과는 id 로만 매핑되어 호출측의
 * 순서 계약을 건드리지 않는다 ③ 개별 실패가 다른 호출을 죽이지 않는다 ④ 동시 상한을 지킨다.
 */
jest.mock('../../config/runtime-limits', () => ({
    ...jest.requireActual('../../config/runtime-limits'),
    READ_ONLY_TOOL_PARALLEL: {
        ENABLED: true,
        MAX_CONCURRENT: 2,
        TOOL_NAMES: ['web_search', 'extract_webpage'],
        MCP_READ_KEYWORDS: ['search', 'news', 'fetch'],
        MCP_WRITE_KEYWORDS: ['write', 'replace', 'delete', 'create'],
    },
}));

import { prefetchReadOnlyCalls, isReadOnlyTool } from '../../services/tool-parallel';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('prefetchReadOnlyCalls', () => {
    test('읽기 전용 2건 이상만 동시에 실행하고 id 로 결과를 돌려준다', async () => {
        const calls = [
            { id: 'a', name: 'web_search' },
            { id: 'b', name: 'bash' },          // 부작용 도구 — 절대 병렬 안 됨
            { id: 'c', name: 'web_search' },
        ];
        const started: string[] = [];
        const res = await prefetchReadOnlyCalls(calls, () => true, async (c) => { started.push(c.id!); await sleep(20); return `R:${c.id}`; }, { path: 'test' });
        expect([...res.keys()].sort()).toEqual(['a', 'c']);
        expect(res.get('a')).toBe('R:a');
        expect(started).not.toContain('b');
    });

    test('1건뿐이면 아무것도 하지 않는다(순차와 같다)', async () => {
        const exec = jest.fn(async () => 'x');
        const res = await prefetchReadOnlyCalls([{ id: 'a', name: 'web_search' }, { id: 'b', name: 'bash' }], () => true, exec, { path: 'test' });
        expect(res.size).toBe(0);
        expect(exec).not.toHaveBeenCalled();
    });

    test('호출측 판정(isEligible)이 false 면 제외한다 — 승인 게이트 등', async () => {
        const calls = [{ id: 'a', name: 'web_search' }, { id: 'b', name: 'web_search' }, { id: 'c', name: 'web_search' }];
        const res = await prefetchReadOnlyCalls(calls, (c) => c.id !== 'b', async (c) => c.id!, { path: 'test' });
        expect([...res.keys()].sort()).toEqual(['a', 'c']);
    });

    test('실제로 겹쳐서 실행되고 동시 상한(2)을 넘지 않는다', async () => {
        let running = 0, peak = 0;
        const calls = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: 'web_search' }));
        await prefetchReadOnlyCalls(calls, () => true, async () => {
            running++; peak = Math.max(peak, running);
            await sleep(30);
            running--; return 'ok';
        }, { path: 'test' });
        expect(peak).toBe(2);   // 1 이면 병렬이 아니고, 3 이상이면 상한을 어긴 것
    });

    test('개별 실패는 그 호출의 Error 결과로만 남고 나머지는 정상', async () => {
        const calls = [{ id: 'a', name: 'web_search' }, { id: 'b', name: 'extract_webpage' }];
        const res = await prefetchReadOnlyCalls(calls, () => true, async (c) => { if (c.id === 'b') throw new Error('boom'); return 'ok'; }, { path: 'test' });
        expect(res.get('a')).toBe('ok');
        expect(res.get('b')).toMatch(/^Error: boom/);
    });

    test('id 가 없는 호출은 제외한다(결과 매핑 불가)', async () => {
        const res = await prefetchReadOnlyCalls([{ id: undefined, name: 'web_search' }, { id: 'b', name: 'web_search' }], () => true, async () => 'ok', { path: 'test' });
        expect(res.size).toBe(0);
    });

    test('isReadOnlyTool — 빌트인은 정확 이름, MCP 는 조회 키워드 ∧ ¬쓰기 키워드', () => {
        expect(isReadOnlyTool('web_search')).toBe(true);
        expect(isReadOnlyTool('file_ops')).toBe(false);
        expect(isReadOnlyTool('mcp-kakao::search-web')).toBe(true);          // 라이브에서 qwen 이 고른 도구
        expect(isReadOnlyTool('noapi-google-search::google_news')).toBe(true);
        expect(isReadOnlyTool('some-mcp::search_and_replace')).toBe(false);   // 조회 키워드가 있어도 쓰기면 제외
        expect(isReadOnlyTool('some-mcp::create_issue')).toBe(false);
        expect(isReadOnlyTool('some-mcp::unknown_tool')).toBe(false);        // 모르면 순차
        expect(isReadOnlyTool('search')).toBe(false);                        // '::' 없는 미등록 이름은 목록 기준
    });
});
