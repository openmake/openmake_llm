/**
 * Web Search 오케스트레이터
 *
 * 다중 검색 프로바이더를 조율하여 통합 웹 검색을 수행합니다.
 * Google CSE / Wikipedia / Google News / DuckDuckGo / Naver News 병렬 수집 후
 * 신뢰도 스코어링 으로 통합. (2026-05-19 이전 Ollama Cloud /api/web_search 우선
 * 단계는 vLLM 마이그레이션 시 제거.)
 *
 * @module mcp/web-search/search-orchestrator
 */

import { SearchResult } from './types';
import {
    searchGoogle,
    searchWikipedia,
    searchGoogleNews,
    searchDuckDuckGoAPI,
    searchNaverNews,
    searchNaverWeb
} from './providers';
import { createLogger } from '../../utils/logger';
import { SEARCH_RELIABILITY } from '../../config/runtime-limits';

const logger = createLogger('WebSearch');

/**
 * 통합 웹 검색 (Ollama API 우선, 폴백으로 다중 소스 병렬)
 *
 * 2단계 검색 전략:
 * 1. Ollama Web Search API (최우선, 고볼륨이 아니면 성공 시 조기 반환)
 * 2. 다중 소스 병렬 검색 (Google, Wikipedia, News, DuckDuckGo, Naver)
 *
 * 결과 우선순위: News > Naver > Google > Wiki > DDG
 * URL 정규화를 통해 중복을 제거합니다.
 *
 * @param query - 검색 쿼리
 * @param options.maxResults - 최대 결과 수 (기본값: 30)
 * @param options.globalSearch - 전세계 검색 여부 (기본값: true)
 * @param options.language - 검색 언어 (기본값: 'en')
 * @returns 중복 제거된 SearchResult 배열
 *
 * 변경 이력: 2026-05-19 — Ollama Cloud /api/web_search 폐기로 useOllamaFirst/searchOllamaWebSearch 제거.
 */
export async function performWebSearch(query: string, options: { maxResults?: number; globalSearch?: boolean; language?: string; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const { maxResults = 30, globalSearch = true, language = 'en', signal } = options;

    // 고볼륨 모드: maxResults > 15이면 모든 소스에서 병렬 수집 (Deep Research 용)
    const highVolumeMode = maxResults > 15;

    logger.info(`쿼리: ${query} (maxResults: ${maxResults}, highVolume: ${highVolumeMode})`);

    // 모든 소스에서 병렬 검색 — 각 provider 는 자체 fetch timeout + 외부 abort signal 로
    // hang 을 방지하므로 Promise.all 이 무한정 멈추지 않는다.
    const searchPromises: Promise<SearchResult[]>[] = [
        searchGoogle(query, 10, globalSearch, language, signal),
        searchWikipedia(query, language, signal),
        searchGoogleNews(query, language, signal),
        searchDuckDuckGoAPI(query, signal),
        // 한국어 쿼리: 네이버 뉴스(모바일 스크래핑) + 웹문서(공식 검색 API) 병렬 수집
        ...(language === 'ko' ? [searchNaverNews(query, 5, signal), searchNaverWeb(query, 10, signal)] : [])
    ];

    const allSearchResults = await Promise.all(searchPromises);
    const googleResults = allSearchResults[0] || [];
    const wikiResults = allSearchResults[1] || [];
    const newsResults = allSearchResults[2] || [];
    const ddgResults = allSearchResults[3] || [];
    // index 4 이후는 전부 네이버 소스(뉴스+웹문서) — 개수 변동에 견고하게 합산
    const naverResults = allSearchResults.slice(4).flat();

    // 결과 합치기 (우선순위: 뉴스 > Naver > Google > Wikipedia > DDG)
    const allResults = [
        ...newsResults,            // 뉴스 (최신 사실 정보)
        ...naverResults,           // 네이버 뉴스 (한국어만)
        ...googleResults,          // Google 검색
        ...wikiResults,            // Wikipedia (배경 지식)
        ...ddgResults              // DuckDuckGo
    ];

    // 중복 제거 (URL 정규화)
    const seen = new Set<string>();
    const uniqueResults = allResults.filter(r => {
        const normalizedUrl = r.url.replace(/\/$/, '').replace(/^https?:\/\//, '').toLowerCase();
        if (seen.has(normalizedUrl)) return false;
        seen.add(normalizedUrl);
        return true;
    });

    logger.info(`총 ${uniqueResults.length}개 (Google:${googleResults.length}, Wiki:${wikiResults.length}, News:${newsResults.length}, DDG:${ddgResults.length}, Naver:${naverResults.length})`);

    // 신뢰도 스코어링 및 정렬
    const scored = uniqueResults.map((result, index) => {
        const reliability = scoreSearchResult(result);
        result.qualityScore = reliability;
        // 기존 순서 기반 관련도 (1.0 → 0.0, 상위일수록 높음)
        const relevance = 1 - (index / Math.max(uniqueResults.length, 1));
        const combinedScore = relevance * SEARCH_RELIABILITY.RELEVANCE_WEIGHT
            + reliability * SEARCH_RELIABILITY.RELIABILITY_WEIGHT;
        return { result, combinedScore };
    });

    scored.sort((a, b) => b.combinedScore - a.combinedScore);

    const sortedResults = scored.map(s => s.result);
    const ranked = applyPerDomainCap(
        sortedResults,
        maxResults,
        SEARCH_RELIABILITY.MAX_PER_DOMAIN,
    );

    // 사실성 보강: 백과/레퍼런스 소스가 컷오프에서 누락되면 보장 포함 (현직 인물·직책 등 사실 질문 정확도)
    return ensureReferenceResults(ranked, sortedResults, maxResults);
}

/**
 * 백과/레퍼런스 소스(REFERENCE_DOMAINS)를 최종 결과에 최소 개수 보장한다.
 *
 * relevance 가 수집 순서 기반이라 백과 결과가 뉴스 가십에 밀려 top-N 컷오프에서 잘리는 문제를
 * 보정한다. 부족분만큼 점수 상위 백과 결과를 **앞쪽**에 삽입(LLM 우선 노출)하고,
 * maxResults 한도를 유지하기 위해 비-레퍼런스 결과를 뒤에서 밀어낸다.
 *
 * @param ranked - applyPerDomainCap 적용 후 최종 후보 (점수 내림차순)
 * @param sortedResults - 점수 내림차순 전체 결과 풀
 * @param maxResults - 최종 최대 개수
 */
export function ensureReferenceResults(
    ranked: SearchResult[],
    sortedResults: SearchResult[],
    maxResults: number,
): SearchResult[] {
    const min = SEARCH_RELIABILITY.MIN_REFERENCE_RESULTS;
    if (min <= 0) return ranked;

    const isReference = (r: SearchResult): boolean => {
        try {
            const host = new URL(r.url).hostname.toLowerCase();
            return SEARCH_RELIABILITY.REFERENCE_DOMAINS.some(d => host.includes(d));
        } catch {
            return false;
        }
    };

    const have = ranked.filter(isReference).length;
    if (have >= min) return ranked;

    const inRanked = new Set(ranked.map(r => r.url));
    const additions = sortedResults
        .filter(r => isReference(r) && !inRanked.has(r.url))
        .slice(0, min - have);
    if (additions.length === 0) return ranked;

    // 백과를 앞에 배치 → 비-레퍼런스 결과는 뒤에서 밀려남 (maxResults 유지)
    return [...additions, ...ranked].slice(0, maxResults);
}

/**
 * 도메인당 상한을 적용해 소스 다양성을 보호한다.
 * 단일 도메인(예: news.google.com RSS)이 결과를 도배해 다양성이 붕괴하는 것을 방지.
 *
 * @param sorted - **점수 내림차순으로 정렬된** 결과 (상위부터 도메인별 cap 만큼 채택)
 * @param maxResults - 최종 최대 개수
 * @param cap - 도메인당 상한. 0 이하면 비활성(기존 동작 = 단순 slice)
 * @returns 도메인당 cap 이하로 제한된 상위 결과 (최대 maxResults)
 */
export function applyPerDomainCap(sorted: SearchResult[], maxResults: number, cap: number): SearchResult[] {
    if (cap <= 0) {
        return sorted.slice(0, maxResults);
    }
    const perDomain = new Map<string, number>();
    const selected: SearchResult[] = [];
    for (const result of sorted) {
        if (selected.length >= maxResults) break;
        let domain = '';
        try {
            domain = new URL(result.url).hostname.toLowerCase().replace(/^www\./, '');
        } catch { /* URL 파싱 실패 → 도메인 캡 미적용으로 통과 */ }
        if (domain) {
            const n = perDomain.get(domain) ?? 0;
            if (n >= cap) continue;
            perDomain.set(domain, n + 1);
        }
        selected.push(result);
    }
    return selected;
}

/**
 * 검색 결과의 신선도/신뢰도를 수치화합니다.
 *
 * 도메인 권위와 게시 날짜를 기반으로 0.0~1.0 사이의 점수를 산출합니다.
 * - 공식 도메인(.gov, .edu, .org 등) → 가산
 * - 1년 이내 게시 → 가산
 * - 3년 이상 경과 → 감산
 * - 의미 있는 스니펫 → 가산
 *
 * @param result - 검색 결과 객체
 * @returns 신뢰도 점수 (0.0~1.0)
 */
function scoreSearchResult(result: SearchResult): number {
    let score = 0.5;

    // 1. 도메인 권위
    try {
        const hostname = new URL(result.url).hostname.toLowerCase();
        const isOfficial = SEARCH_RELIABILITY.OFFICIAL_DOMAINS.some(
            domain => hostname.endsWith(domain)
        );
        if (isOfficial) {
            score += SEARCH_RELIABILITY.OFFICIAL_DOMAIN_BOOST;
        }
    } catch {
        // URL 파싱 실패 무시
    }

    // 2. 날짜 신선도
    if (result.date) {
        try {
            const pubDate = new Date(result.date);
            const daysSince = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince <= SEARCH_RELIABILITY.RECENCY_BONUS_DAYS) {
                score += 0.2;
            } else if (daysSince > SEARCH_RELIABILITY.RECENCY_PENALTY_DAYS) {
                score -= 0.1;
            }
        } catch {
            // 날짜 파싱 실패 무시
        }
    }

    // 3. 스니펫 품질 (의미 있는 길이)
    if (result.snippet && result.snippet.length > 80) {
        score += 0.1;
    }

    return Math.min(1.0, Math.max(0.0, score));
}

/**
 * 사실 검증 프롬프트 생성
 *
 * 검색 결과를 포맷팅하여 LLM에게 사실 검증을 요청하는 프롬프트를 생성합니다.
 *
 * @param claim - 검증할 주장 또는 질문
 * @param searchResults - 근거 자료 검색 결과
 * @returns 포맷팅된 사실 검증 프롬프트 문자열
 */
export function createFactCheckPrompt(claim: string, searchResults: SearchResult[]): string {
    const sources = searchResults.map((r, i) =>
        `[${i + 1}] ${r.title}\n   ${r.url}\n   ${r.snippet}`
    ).join('\n\n');

    return `## Web Search Results (${new Date().toLocaleDateString()})
${sources || '검색 결과 없음'}

## 질문
${claim}

위 검색 결과를 참고하여 정확하게 답변하세요.`;
}
