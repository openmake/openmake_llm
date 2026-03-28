/**
 * Web Search 오케스트레이터
 *
 * 다중 검색 프로바이더를 조율하여 통합 웹 검색을 수행합니다.
 * 2단계 검색 전략 (Ollama -> 다중 소스 병렬)을 구현합니다.
 *
 * @module mcp/web-search/search-orchestrator
 */

import { SearchResult } from './types';
import {
    searchOllamaWebSearch,
    searchGoogle,
    searchWikipedia,
    searchGoogleNews,
    searchDuckDuckGoAPI,
    searchNaverNews
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
 * 결과 우선순위: Ollama > News > Naver > Google > Wiki > DDG
 * URL 정규화를 통해 중복을 제거합니다.
 *
 * @param query - 검색 쿼리
 * @param options.maxResults - 최대 결과 수 (기본값: 30)
 * @param options.globalSearch - 전세계 검색 여부 (기본값: true)
 * @param options.useOllamaFirst - Ollama API 우선 사용 (기본값: true)
 * @param options.language - 검색 언어 (기본값: 'en')
 * @returns 중복 제거된 SearchResult 배열
 */
export async function performWebSearch(query: string, options: { maxResults?: number; globalSearch?: boolean; useOllamaFirst?: boolean; language?: string } = {}): Promise<SearchResult[]> {
    const { maxResults = 30, globalSearch = true, useOllamaFirst = true, language = 'en' } = options;

    // 고볼륨 모드: maxResults > 15이면 모든 소스에서 병렬 수집 (Deep Research 용)
    const highVolumeMode = maxResults > 15;

    logger.info(`쿼리: ${query} (maxResults: ${maxResults}, highVolume: ${highVolumeMode})`);

    // 1단계: Ollama 공식 API 우선 시도 (고볼륨이 아닌 경우에만 조기 반환)
    let earlyOllamaResults: SearchResult[] = [];
    if (useOllamaFirst) {
        earlyOllamaResults = await searchOllamaWebSearch(query, Math.min(maxResults, 10));
        if (earlyOllamaResults.length > 0 && !highVolumeMode) {
            logger.info(`Ollama API 성공: ${earlyOllamaResults.length}개 결과`);
            return earlyOllamaResults;
        }
        if (earlyOllamaResults.length === 0) {
            logger.info('Ollama API 결과 없음, 폴백 검색 시작...');
        }
    }

    // 2단계: 모든 소스에서 병렬 검색
    const searchPromises: Promise<SearchResult[]>[] = [
        searchGoogle(query, 10, globalSearch, language),
        searchWikipedia(query, language),
        searchGoogleNews(query, language),
        searchDuckDuckGoAPI(query),
        ...(language === 'ko' ? [searchNaverNews(query)] : [])
    ];

    const allSearchResults = await Promise.all(searchPromises);
    const googleResults = allSearchResults[0] || [];
    const wikiResults = allSearchResults[1] || [];
    const newsResults = allSearchResults[2] || [];
    const ddgResults = allSearchResults[3] || [];
    const naverResults = allSearchResults[4] || [];

    // 결과 합치기 (우선순위: Ollama > 뉴스 > Naver > Google > Wikipedia > DDG)
    const allResults = [
        ...earlyOllamaResults,     // Ollama API 결과
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

    logger.info(`총 ${uniqueResults.length}개 (Ollama:${earlyOllamaResults.length}, Google:${googleResults.length}, Wiki:${wikiResults.length}, News:${newsResults.length}, DDG:${ddgResults.length}, Naver:${naverResults.length})`);

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

    return scored.map(s => s.result).slice(0, maxResults);
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
