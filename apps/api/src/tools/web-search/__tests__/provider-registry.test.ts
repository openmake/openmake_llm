/**
 * 검색 provider 레지스트리 — 병합 순서는 group 이 정하고(종전 고정 배열의 우선순위 그대로), 지역 provider 는 언어로 거른다.
 */
import { performWebSearch } from '../search-orchestrator';
import {
    listSearchProviders, registerContentSearchProvider, registerSearchEscalation, registerSearchProvider,
    resetSearchProviders, searchContentProviders, type SearchGroup,
} from '../provider-registry';
import type { SearchResult } from '../types';

// 기본 provider 는 실제 네트워크를 탄다 — 이 테스트는 레지스트리에 가짜만 올린다
jest.mock('../default-providers', () => ({ ensureDefaultSearchProviders: jest.fn() }));
jest.mock('../semantic-reranker', () => ({ logSemanticRerankShadow: jest.fn(), rerankBySemantics: jest.fn(async (_q: string, r: SearchResult[]) => r) }));
jest.mock('../../../services/cost/cost-ledger-service', () => ({ recordCost: jest.fn() }));

const hit = (id: string): SearchResult => ({ title: `검색 ${id}`, url: `https://${id}.example.com/a`, snippet: `검색 ${id}`, source: id } as SearchResult);
const fake = (id: string, group: SearchGroup, extra: Partial<Parameters<typeof registerSearchProvider>[0]> = {}) =>
    registerSearchProvider({ id, group, logLabel: id, search: async () => [hit(id)], ...extra });

beforeEach(() => resetSearchProviders());

describe('listSearchProviders', () => {
    it('group 우선순위(메타 > 뉴스 > 지역 > 웹 > 참고 > 폴백) → 같은 group 은 등록 순서', () => {
        fake('ddg', 'fallback'); fake('google', 'web'); fake('naver-news', 'regional'); fake('wiki', 'reference');
        fake('searxng', 'meta'); fake('daum', 'regional'); fake('news', 'news');
        expect(listSearchProviders().map((p) => p.id)).toEqual(['searxng', 'news', 'naver-news', 'daum', 'google', 'wiki', 'ddg']);
    });

    it('같은 id 재등록은 교체한다 (중복이 쌓이지 않는다)', () => {
        fake('a', 'web'); fake('a', 'meta');
        expect(listSearchProviders()).toHaveLength(1);
        expect(listSearchProviders()[0].group).toBe('meta');
    });
});

describe('performWebSearch × 레지스트리', () => {
    it('applies 가 거른 provider 는 호출되지 않는다 — 지역 provider 는 한국어 질의에만', async () => {
        const regional = jest.fn(async () => [hit('regional')]);
        fake('meta', 'meta');
        fake('regional', 'regional', { applies: (c) => c.language === 'ko', search: regional });

        await performWebSearch('weather in seoul', { language: 'en', maxResults: 10 });
        expect(regional).not.toHaveBeenCalled();
        const ko = await performWebSearch('서울 검색', { language: 'ko', maxResults: 10 });
        expect(regional).toHaveBeenCalledTimes(1);
        expect(ko.map((r) => r.source)).toEqual(expect.arrayContaining(['meta', 'regional']));
    });

    it('provider 하나가 던져도 나머지 결과로 끝난다', async () => {
        fake('ok', 'meta');
        fake('boom', 'web', { search: async () => { throw new Error('down'); } });
        const results = await performWebSearch('검색 테스트', { language: 'ko', maxResults: 10 });
        expect(results.map((r) => r.source)).toEqual(['ok']);
    });

    it('provider 가 하나도 없으면 빈 결과 — 예외가 아니다', async () => {
        expect(await performWebSearch('검색', { language: 'ko', maxResults: 10 })).toEqual([]);
    });

    it('보강 provider 는 기본 수집이 부족할 때 불린다', async () => {
        const escalate = jest.fn(async () => [hit('exa')]);
        fake('only', 'meta');
        registerSearchEscalation({ id: 'exa', logLabel: 'Exa', search: escalate });
        const results = await performWebSearch('검색 보강', { language: 'ko', maxResults: 10 });
        expect(escalate).toHaveBeenCalled();
        expect(results.map((r) => r.source)).toEqual(expect.arrayContaining(['only', 'exa']));
    });
});

describe('searchContentProviders', () => {
    it('등록이 없으면 빈 배열, 실패한 provider 는 건너뛴다', async () => {
        expect(await searchContentProviders('q', 5, 'basic')).toEqual([]);
        registerContentSearchProvider({ id: 'bad', search: async () => { throw new Error('x'); } });
        registerContentSearchProvider({ id: 'good', search: async () => [hit('good')] });
        expect((await searchContentProviders('q', 5, 'advanced')).map((r) => r.source)).toEqual(['good']);
    });
});
