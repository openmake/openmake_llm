/**
 * search-providers add-on — 지역(한국어)·유료 검색 공급원을 Base 검색 레지스트리에 꽂는다.
 * 매니페스트 `entry.runtime` 이 부팅 때 한 번 부른다. 키가 없으면 각 provider 가 빈 배열을 돌려주므로 등록은 항상 한다.
 *
 * @module addons/search-providers
 */
import { registerContentSearchProvider, registerSearchEscalation, registerSearchProvider } from '../../tools/web-search/provider-registry';
import { searchDaumWeb, searchNaverEncyc, searchNaverNews, searchNaverWeb } from './regional-providers';
import { searchExa, searchTavily } from './external-search-apis';

const KOREAN = 'ko';

/** 등록 순서 = 같은 group 안의 병합 순서 (뉴스 → 웹문서 → 백과 → Daum) */
export async function startSearchProviders(): Promise<void> {
    const korean = (ctx: { language: string }): boolean => ctx.language === KOREAN;
    registerSearchProvider({ id: 'naver-news', group: 'regional', logLabel: 'Naver', countsAsNews: true, applies: korean, search: (c) => searchNaverNews(c.query, 5, c.signal) });
    registerSearchProvider({ id: 'naver-web', group: 'regional', logLabel: 'Naver', countsAsNews: true, applies: korean, search: (c) => searchNaverWeb(c.query, 10, c.signal) });
    registerSearchProvider({ id: 'naver-encyc', group: 'regional', logLabel: 'Naver', countsAsNews: true, applies: korean, search: (c) => searchNaverEncyc(c.query, 5, c.signal) });
    registerSearchProvider({ id: 'daum-web', group: 'regional', logLabel: 'Naver', countsAsNews: true, applies: korean, search: (c) => searchDaumWeb(c.query, 10, c.signal) });
    registerSearchEscalation({ id: 'exa', logLabel: 'Exa', search: searchExa });
    registerContentSearchProvider({ id: 'tavily', search: searchTavily });
}
