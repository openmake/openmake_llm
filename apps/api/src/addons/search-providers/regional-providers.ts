/**
 * 지역(한국어) 검색 provider — 네이버 뉴스·웹문서·백과 + 카카오(Daum) 웹문서.
 * 2026-09-20 Base `tools/web-search/providers.ts` 에서 옮겨 왔다(1차 계획 §9 "Web search providers → Add-on").
 * 설정 키는 이 add-on 이 기여하고(contributions.ts) 값은 호출마다 settings.ts 로 읽는다 — 관리자 설정의 런타임 변경이 바로 닿는다.
 *
 * @module addons/search-providers/regional-providers
 */
import type { SearchResult } from '../../tools/web-search/types';
import { searchFetch, describeFetchError, decodeXmlEntities } from '../../tools/web-search/providers';
import { searchProviderSettings } from './settings';
import { createLogger } from '../../utils/logger';
import { buildNaverSearchRequest } from './naver-client';

const logger = createLogger('WebSearch');

/**
 * 네이버 뉴스 검색 (공식 검색 API)
 *
 * `openapi.naver.com/v1/search/news.json` 을 호출하여 한국어 뉴스를 검색합니다.
 * `sort=date` 로 최신순 정렬 — 시의성 사실(현직 인물·최신 이슈) 커버리지를 강화하여
 * 웹문서(webkr) 검색이 약한 "현재 상태" 질의를 보완합니다. pubDate 를 freshness 스코어링에 활용.
 * (2026-06-01 모바일 페이지 스크래핑 → 공식 API 전환. NAVER_CLIENT_ID/SECRET 인증 필요,
 *  키 미설정 시 빈 배열 graceful. 한도 25,000회/일, Client ID 별 합산.)
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 5, API 제한: 최대 100)
 * @returns SearchResult 배열 (키 미설정/실패 시 빈 배열)
 */
export async function searchNaverNews(query: string, maxResults: number = 5, signal?: AbortSignal): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        const display = Math.min(Math.max(maxResults, 1), 100);
        // legacy ↔ NAVER API HUB 듀얼 경로 + 일일 한도 가드 — 키 미설정/한도 도달 시 null → 빈 배열 graceful
        const req = await buildNaverSearchRequest('news', `query=${encodeURIComponent(query)}&display=${display}&sort=date`);
        if (!req) return results;

        const response = await searchFetch(req.url, signal, { headers: req.headers });

        if (!response.ok) {
            // 403 = 등록 앱에 '검색' API 미설정, 429 = 일일 허용량 초과 (HUB 문서 명시).
            logger.error(`네이버 뉴스 API 오류(${req.route}): ${response.status}${response.status === 403 ? ' (앱 검색 API 미설정 가능성)' : response.status === 429 ? ' (일일 허용량 초과)' : ''}`);
            return results;
        }

        const data = await response.json() as { items?: Array<{ title?: string; link?: string; originallink?: string; description?: string; pubDate?: string }> };

        if (data.items) {
            for (const item of data.items) {
                results.push({
                    title: stripNaverTags(item.title || ''),
                    url: item.link || item.originallink || '',
                    snippet: stripNaverTags(item.description || ''),
                    source: 'naver.com',
                    ...(item.pubDate ? { date: item.pubDate } : {}),
                });
            }
        }
        logger.info(`네이버 뉴스: ${results.length}개`);
    } catch (e) {
        logger.error('네이버 뉴스 실패:', describeFetchError(e));
    }

    return results;
}

/**
 * Naver 검색 결과의 하이라이트 `<b>` 태그 + XML 엔티티 제거.
 *
 * Naver 검색 API 는 검색어 일치 부분을 `<b>...</b>` 로 감싸고 `&lt;` 등 엔티티를 포함합니다.
 *
 * @param text - Naver API title/description 원문
 * @returns 태그·엔티티가 제거된 평문
 */
function stripNaverTags(text: string): string {
    return decodeXmlEntities(text.replace(/<\/?b>/gi, '')).trim();
}

/**
 * 네이버 문서형 검색 공통 구현 — webkr(웹문서)·encyc(백과사전)는 요청/응답 계약이 동일
 * (`items[].title/link/description`, sort 파라미터 없음)해 한 구현을 공유한다.
 * 키 미설정/일일 한도 도달 시 빈 배열 반환 (graceful). API 한도 25,000회/일 (Client ID 별 합산).
 */
async function searchNaverDocuments(
    endpoint: 'webkr' | 'encyc',
    label: string,
    query: string,
    maxResults: number,
    signal?: AbortSignal,
): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
        const display = Math.min(Math.max(maxResults, 1), 100);
        // legacy ↔ NAVER API HUB 듀얼 경로 + 일일 한도 가드 — 키 미설정/한도 도달 시 null → 빈 배열 graceful
        const req = await buildNaverSearchRequest(endpoint, `query=${encodeURIComponent(query)}&display=${display}`);
        if (!req) return results;

        const response = await searchFetch(req.url, signal, { headers: req.headers });

        if (!response.ok) {
            // 401(HUB) = NCP 콘솔에서 해당 검색 API 미활성화, 403 = 등록 앱에 '검색' API 미설정,
            // 429 = 일일 허용량 초과 (HUB 문서 명시 + 2026-08-14 라이브 실측).
            logger.error(`${label} API 오류(${req.route}): ${response.status}${response.status === 401 ? ' (HUB 앱에 해당 검색 API 미활성화 가능성)' : response.status === 403 ? ' (앱 검색 API 미설정 가능성)' : response.status === 429 ? ' (일일 허용량 초과)' : ''}`);
            return results;
        }

        const data = await response.json() as { items?: Array<{ title?: string; link?: string; description?: string }> };

        if (data.items) {
            for (const item of data.items) {
                results.push({
                    title: stripNaverTags(item.title || ''),
                    url: item.link || '',
                    snippet: stripNaverTags(item.description || ''),
                    source: 'naver.com',
                });
            }
        }
        logger.info(`${label}: ${results.length}개`);
    } catch (e) {
        logger.error(`${label} 실패:`, describeFetchError(e));
    }

    return results;
}

/**
 * 네이버 웹문서 검색 (공식 검색 API)
 *
 * `openapi.naver.com/v1/search/webkr.json` 을 호출하여 한국어 웹 문서를 검색합니다.
 * 모바일 스크래핑(searchNaverNews)과 달리 안정적이며, NAVER_CLIENT_ID/SECRET 인증이 필요합니다.
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 10, API 제한: 최대 100)
 * @returns SearchResult 배열 (키 미설정/실패 시 빈 배열)
 */
export async function searchNaverWeb(query: string, maxResults: number = 10, signal?: AbortSignal): Promise<SearchResult[]> {
    return searchNaverDocuments('webkr', '네이버 웹문서', query, maxResults, signal);
}

/**
 * 네이버 백과사전 검색 (공식 검색 API)
 *
 * `openapi.naver.com/v1/search/encyc.json` 을 호출하여 네이버 지식백과(terms.naver.com) 항목을
 * 검색합니다. 개인 블로그 위주인 웹문서 풀에 권위 있는 한국어 배경지식 소스를 보강하는 용도.
 * ⚠️ HUB 경로는 NCP 콘솔에서 '백과사전' 검색 API 를 활성화해야 한다 (미활성 시 401 → 빈 배열
 * graceful). doc(전문자료) API 는 네이버가 폐지(SE05)해 추가 불가 — 2026-08-14 실측.
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 5, API 제한: 최대 100)
 * @returns SearchResult 배열 (키 미설정/실패 시 빈 배열)
 */
export async function searchNaverEncyc(query: string, maxResults: number = 5, signal?: AbortSignal): Promise<SearchResult[]> {
    return searchNaverDocuments('encyc', '네이버 백과사전', query, maxResults, signal);
}

// ============================================================
// 카카오(Daum) 웹문서 검색 (공식 검색 API)
// ============================================================
/** Daum 검색 API 엔드포인트 — `Authorization: KakaoAK <REST 키>` 헤더 인증 */
const DAUM_SEARCH_WEB_URL = 'https://dapi.kakao.com/v2/search/web';

/**
 * 카카오(Daum) 웹문서 검색 — 네이버와 색인이 다른 한국어 2공급원.
 *
 * `dapi.kakao.com/v2/search/web` 을 호출한다. `KAKAO_REST_API_KEY`(카카오 개발자 콘솔
 * REST API 키 — 지도 MCP 서버와 동일 키 재사용 가능) 미설정 시 빈 배열 graceful.
 * 무료 쿼터(웹문서 일 30,000회) 초과는 429 차단(무과금)이라 네이버식 과금 방지 가드는 두지 않는다.
 * title/contents 의 `<b>` 하이라이트는 네이버와 동일 포맷이라 stripNaverTags 를 재사용한다.
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수 (기본값: 10, API 제한: 최대 50)
 * @returns SearchResult 배열 (키 미설정/실패 시 빈 배열)
 */
export async function searchDaumWeb(query: string, maxResults: number = 10, signal?: AbortSignal): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const { kakaoRestApiKey } = searchProviderSettings();
    if (!kakaoRestApiKey) return results;

    try {
        const size = Math.min(Math.max(maxResults, 1), 50);
        const url = `${DAUM_SEARCH_WEB_URL}?query=${encodeURIComponent(query)}&size=${size}`;
        const response = await searchFetch(url, signal, {
            headers: { Authorization: `KakaoAK ${kakaoRestApiKey}` },
        });

        if (!response.ok) {
            // 401 = REST 키 오류, 429 = 일일 쿼터 초과(무과금 차단)
            logger.error(`Daum 웹문서 API 오류: ${response.status}${response.status === 401 ? ' (REST 키 확인 필요)' : response.status === 429 ? ' (일일 쿼터 초과)' : ''}`);
            return results;
        }

        const data = await response.json() as { documents?: Array<{ title?: string; url?: string; contents?: string; datetime?: string }> };

        for (const doc of data.documents || []) {
            if (!doc.url) continue;
            results.push({
                title: stripNaverTags(doc.title || ''),
                url: doc.url,
                snippet: stripNaverTags(doc.contents || ''),
                source: 'daum.net',
                ...(doc.datetime ? { date: doc.datetime } : {}),
            });
        }
        logger.info(`Daum 웹문서: ${results.length}개`);
    } catch (e) {
        logger.error('Daum 웹문서 실패:', describeFetchError(e));
    }

    return results;
}

// ============================================================
// SearXNG 메타검색 (자가호스팅 docker, API key 불필요 — Google CSE 무료 대체)
// 70+ 검색엔진을 집계해 관련도 높은 결과를 제공. SEARXNG_URL 미설정 시 비활성.
