/**
 * 외부 공식 검색 API provider (무료 크레딧 계층) — providers.ts 에서 분리 (600줄 CI 가드).
 *
 * - Exa: Tier 0(무료) 수집 부족 시에만 호출하는 escalation 전용 (search-orchestrator).
 * - Tavily: Deep Research 파이프라인 전용 (deep-research/source-searcher).
 *
 * 두 provider 모두 키 미설정 시 빈 배열 graceful — 기존 무료 구성 동작 무변경.
 *
 * @module mcp/web-search/external-search-apis
 */
import { SearchResult } from './types';
import { getConfig } from '../../config/env';
import { createLogger } from '../../utils/logger';
import { searchFetch, describeFetchError } from './providers';

const logger = createLogger('WebSearch');

/** Exa Search API 엔드포인트 — `x-api-key` 헤더 인증 */
const EXA_SEARCH_URL = 'https://api.exa.ai/search';

/**
 * Exa 시맨틱 검색 — 무료 Tier 0 수집이 부족할 때만 호출하는 escalation 전용 provider.
 *
 * `EXA_API_KEY`(카드 불필요, 월 $10 무료 크레딧 ≈ 1,400회) 미설정 시 빈 배열 graceful.
 * 크레딧 절약을 위해 contents(본문) 없이 검색만 요청한다 — snippet 은 비어 오므로
 * 랭킹은 제목 매칭·도메인 신뢰도에 의존한다.
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수
 * @returns SearchResult 배열 (키 미설정/실패 시 빈 배열)
 */
export async function searchExa(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const { exaApiKey } = getConfig();
    if (!exaApiKey) return results;

    try {
        const response = await searchFetch(EXA_SEARCH_URL, signal, {
            method: 'POST',
            headers: { 'x-api-key': exaApiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, numResults: maxResults, type: 'auto' }),
        });

        if (!response.ok) {
            // 401 = 키 오류, 402 = 크레딧 소진, 429 = rate limit
            logger.error(`Exa API 오류: ${response.status}${response.status === 402 ? ' (크레딧 소진)' : ''}`);
            return results;
        }

        const data = await response.json() as { results?: Array<{ title?: string; url?: string; publishedDate?: string }> };

        for (const item of data.results || []) {
            if (!item.url) continue;
            results.push({
                title: item.title || '',
                url: item.url,
                snippet: '',
                source: 'exa.ai',
                ...(item.publishedDate ? { date: item.publishedDate } : {}),
            });
        }
        logger.info(`Exa(escalation): ${results.length}개`);
    } catch (e) {
        logger.error('Exa 검색 실패:', describeFetchError(e));
    }

    return results;
}

/** Tavily Search API 엔드포인트 — `Authorization: Bearer` 인증 */
const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

/**
 * Tavily 검색 — Deep Research 파이프라인 전용 provider (일반 검색에는 쓰지 않음).
 *
 * `TAVILY_API_KEY`(카드 불필요, 월 1,000 크레딧) 미설정 시 빈 배열 graceful.
 * 정제 본문(content)이 snippet 으로 실려 와 별도 스크랩 없이도 그라운딩 품질이 높다.
 *
 * @param query - 검색 쿼리
 * @param maxResults - 최대 결과 수
 * @param searchDepth - basic(1크레딧) | advanced(2크레딧, 본문 정제 강화)
 * @returns SearchResult 배열 (키 미설정/실패 시 빈 배열)
 */
export async function searchTavily(
    query: string,
    maxResults: number,
    searchDepth: 'basic' | 'advanced' = 'advanced',
    signal?: AbortSignal,
): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const { tavilyApiKey } = getConfig();
    if (!tavilyApiKey) return results;

    try {
        const response = await searchFetch(TAVILY_SEARCH_URL, signal, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tavilyApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, max_results: maxResults, search_depth: searchDepth }),
        });

        if (!response.ok) {
            // 401 = 키 오류, 432/429 = 크레딧/한도 초과
            logger.error(`Tavily API 오류: ${response.status}`);
            return results;
        }

        const data = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }> };

        for (const item of data.results || []) {
            if (!item.url) continue;
            results.push({
                title: item.title || '',
                url: item.url,
                snippet: item.content || '',
                source: 'tavily.com',
                ...(item.published_date ? { date: item.published_date } : {}),
            });
        }
        logger.info(`Tavily(deep-research): ${results.length}개`);
    } catch (e) {
        logger.error('Tavily 검색 실패:', describeFetchError(e));
    }

    return results;
}
