/**
 * Deep Research - 소스 검색 모듈
 *
 * 서브 토픽에 대해 웹 검색을 수행합니다.
 *
 * @module services/deep-research/source-searcher
 */

import type { OllamaClient } from '../../ollama/client';
import type { SearchResult } from '../../mcp/web-search';
import { performWebSearch } from '../../mcp/web-search';
import type { ResearchConfig, SubTopic } from '../deep-research-types';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';
import { CAPACITY, RESEARCH_DEFAULTS } from '../../config/runtime-limits';
import { normalizeUrl } from '../deep-research-utils';
import { parallelBatch } from '../../workflow/graph-engine';

const logger = createLogger('DeepResearch:SourceSearcher');

/**
 * 서브 토픽에 대해 웹 검색 수행
 */
/**
 * 검색 쿼리를 최대 단어 수로 잘라 핵심 키워드만 유지
 */
function truncateQuery(query: string, maxWords: number): string {
    const words = query.trim().split(/\s+/);
    if (words.length <= maxWords) return query.trim();
    return words.slice(0, maxWords).join(' ');
}

/**
 * 서브 토픽에 대해 웹 검색 수행
 */
export async function searchSubTopics(params: {
    client: OllamaClient;
    config: ResearchConfig;
    subTopics: SubTopic[];
    sessionId: string;
    loopNumber: number;
    sourceMap: Map<string, SearchResult>;
    seenUrls: Set<string>;
    usedQueries: Set<string>;
    abortSignal?: AbortSignal;
    throwIfAborted: () => void;
}): Promise<SearchResult[]> {
    const { config, subTopics, sessionId, loopNumber, sourceMap, seenUrls, usedQueries, abortSignal, throwIfAborted } = params;

    throwIfAborted();
    const db = getUnifiedDatabase();
    const discoveredResults: SearchResult[] = [];

    const averageQueriesPerTopic = Math.max(
        1,
        Math.round(
            subTopics.reduce((sum, topic) => sum + topic.searchQueries.length, 0) / Math.max(subTopics.length, 1)
        )
    );

    const denominator = Math.max(subTopics.length * averageQueriesPerTopic, 1);
    const resultsPerQuery = Math.max(15, Math.ceil(config.maxSearchResults / denominator));

    // 모든 (서브토픽, 쿼리) 쌍을 플래팅 — 이미 사용한 쿼리는 제외
    const maxWords = RESEARCH_DEFAULTS.SEARCH_QUERY_MAX_WORDS;
    const allQueries = subTopics.flatMap(st =>
        st.searchQueries.map(q => ({ subTopic: st, query: truncateQuery(q, maxWords) }))
    ).filter(({ query }) => {
        const normalized = query.toLowerCase().trim();
        if (usedQueries.has(normalized)) return false;
        usedQueries.add(normalized);
        return true;
    });

    let stepIndex = 0;

    // 서브토픽 쿼리들을 병렬 실행 (동시 5개)
    await parallelBatch(
        allQueries,
        async ({ query }) => {
            throwIfAborted();
            if (sourceMap.size >= config.maxTotalSources) return;

            try {
                const results = await performWebSearch(query, {
                    maxResults: resultsPerQuery,
                    useOllamaFirst: config.searchApi === 'ollama' || config.searchApi === 'all',
                    language: config.language
                });

                const uniqueForQuery: SearchResult[] = [];
                for (const result of results) {
                    if (!result.url) continue;
                    const normalizedUrl_ = normalizeUrl(result.url);
                    if (seenUrls.has(normalizedUrl_)) continue;

                    seenUrls.add(normalizedUrl_);
                    sourceMap.set(normalizedUrl_, result);
                    discoveredResults.push(result);
                    uniqueForQuery.push(result);

                    if (sourceMap.size >= config.maxTotalSources) break;
                }

                await db.addResearchStep({
                    sessionId,
                    stepNumber: loopNumber * 100 + (++stepIndex),
                    stepType: 'search',
                    query,
                    result: `${results.length}개 검색, ${uniqueForQuery.length}개 신규 확보`,
                    sources: uniqueForQuery.slice(0, CAPACITY.RESEARCH_MAX_SOURCES_PER_QUERY).map(item => item.url),
                    status: 'completed'
                });
            } catch (error) {
                logger.warn(`[DeepResearch] 검색 실패 (${query}): ${error instanceof Error ? error.message : String(error)}`);
            }
        },
        {
            concurrency: 5,
            signal: abortSignal
        }
    );

    return discoveredResults;
}
