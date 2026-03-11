/**
 * ============================================================
 * DeepResearchService - 심층 연구 자동화 서비스
 * ============================================================
 *
 * ollama-deep-researcher MCP와 유사한 기능 제공:
 * - 주제 분해 → 웹 검색 → Firecrawl 스크래핑 → 청크 합성 → 반복 루프 → 보고서 생성
 *
 * @module services/DeepResearchService
 */

import { OllamaClient, createClient } from '../../ollama/client';
import { performWebSearch, SearchResult } from '../../mcp/web-search';
import { isFirecrawlConfigured } from '../../mcp/firecrawl';
import { firecrawlPost } from '../../utils/firecrawl-client';
import { getConfig } from '../../config/env';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';
import { CAPACITY, TRUNCATION } from '../../config/runtime-limits';
import { v4 as uuidv4 } from 'uuid';

import {
    ResearchConfig,
    ResearchProgress,
    ResearchResult,
    SubTopic,
    SynthesisResult,
    globalConfig,
    setGlobalConfig
} from './deep-research-types';

import {
    deduplicateSources,
    normalizeUrl,
    clampImportance,
    buildFallbackSubTopics,
    chunkArray,
    extractBulletLikeFindings,
    getLoopProgressRange
} from './deep-research-utils';

import {
    SECTION_HEADERS,
    getDecomposePrompt,
    getChunkSummaryPrompt,
    getMergePrompt,
    getNeedMorePrompt,
    getReportPrompt,
    getResearchMessage
} from './deep-research-prompts';

import { parallelBatch } from '../../utils/graph-engine';
import { errorMessage } from '../../utils/error-message';

// Re-export types so consumers don't break
export type { ResearchConfig, ResearchProgress, ResearchResult };
// Re-export prompt helper for external consumers
export { getResearchMessage } from './deep-research-prompts';

const logger = createLogger('DeepResearchService');

// DeepResearchService 클래스
// ============================================================

export class DeepResearchService {
    private client: OllamaClient;
    private config: ResearchConfig;
    private abortController: AbortController | null = null;

    constructor(config?: Partial<ResearchConfig>) {
        this.config = { ...globalConfig, ...config };
        // 기본 llmModel이 비어있으면 환경 설정(OMK_ENGINE_FAST)에서 resolve
        if (!this.config.llmModel) {
            this.config.llmModel = getConfig().omkEngineFast;
            logger.info(`[DeepResearch] llmModel 미지정 → ${this.config.llmModel} (OMK_ENGINE_FAST)`);
        }
        this.client = createClient({ model: this.config.llmModel });
    }

    /**
     * 리서치 실행 (메인 엔트리포인트)
     */
    async executeResearch(
        sessionId: string,
        topic: string,
        onProgress?: (progress: ResearchProgress) => void
    ): Promise<ResearchResult> {
        const startTime = Date.now();
        const db = getUnifiedDatabase();
        this.abortController = new AbortController();

        logger.info(`[DeepResearch] 시작: ${topic} (세션: ${sessionId})`);

        try {
            this.throwIfAborted();
            await db.updateResearchSession(sessionId, { status: 'running', progress: 0 });
            this.reportProgress(onProgress, sessionId, 'running', 0, this.config.maxLoops, '초기화', 0, getResearchMessage('init', this.config.language));

            // 1단계: 주제 분해 (0-5%)
            this.throwIfAborted();
            this.reportProgress(onProgress, sessionId, 'running', 0, this.config.maxLoops, 'decompose', 2, getResearchMessage('analyzing', this.config.language));
            const subTopics = await this.decomposeTopics(topic, sessionId);
            await db.updateResearchSession(sessionId, { progress: 5 });
            this.reportProgress(
                onProgress,
                sessionId,
                'running',
                0,
                this.config.maxLoops,
                'decompose',
                5,
                getResearchMessage('subtopicsComplete', this.config.language, { count: subTopics.length })
            );

            // 2단계: 반복 리서치 루프 (5-85%)
            const sourceMap = new Map<string, SearchResult>();
            const seenUrls = new Set<string>();
            const scrapedUrls = new Set<string>();
            const allFindings: string[] = [];

            for (let loop = 0; loop < this.config.maxLoops; loop++) {
                this.throwIfAborted();
                const loopNumber = loop + 1;
                const loopRange = getLoopProgressRange(loop, this.config.maxLoops);

                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'search',
                    loopRange.searchStart,
                    getResearchMessage('loopSearching', this.config.language, { loop: loopNumber })
                );

                const newlyDiscovered = await this.searchSubTopics(
                    subTopics,
                    sessionId,
                    loopNumber,
                    sourceMap,
                    seenUrls
                );
                this.throwIfAborted();

                const uniqueSources = Array.from(sourceMap.values());
                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'search',
                    loopRange.searchEnd,
                    getResearchMessage('loopSearchComplete', this.config.language, {
                        loop: loopNumber,
                        newCount: newlyDiscovered.length,
                        totalCount: uniqueSources.length,
                        maxSources: this.config.maxTotalSources
                    })
                );

                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'scrape',
                    loopRange.scrapeStart,
                    getResearchMessage('loopScraping', this.config.language, {
                        loop: loopNumber,
                        scrapedCount: scrapedUrls.size,
                        maxSources: this.config.maxTotalSources
                    })
                );

                await this.scrapeSources(
                    uniqueSources,
                    scrapedUrls,
                    sessionId,
                    loopNumber,
                    onProgress,
                    loopRange.scrapeStart,
                    loopRange.scrapeEnd
                );
                this.throwIfAborted();

                const sourcesAfterScrape = Array.from(sourceMap.values());

                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'synthesize',
                    loopRange.synthesizeStart,
                    getResearchMessage('loopSynthesizing', this.config.language, { loop: loopNumber })
                );

                const synthesis = await this.synthesizeFindings(topic, sourcesAfterScrape, sessionId, loopNumber);
                allFindings.push(synthesis.summary);
                this.throwIfAborted();

                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'synthesize',
                    loopRange.synthesizeEnd,
                    getResearchMessage('loopSynthComplete', this.config.language, {
                        loop: loopNumber,
                        sourceCount: sourcesAfterScrape.length
                    })
                );

                await db.updateResearchSession(sessionId, { progress: Math.round(loopRange.synthesizeEnd) });

                // 목표 소스 수 도달 시 조기 종료
                if (sourcesAfterScrape.length >= this.config.maxTotalSources) {
                    logger.info(`[DeepResearch] 목표 소스 수 도달 (${sourcesAfterScrape.length}/${this.config.maxTotalSources}). 조기 종료.`);
                    break;
                }

                // 마지막 루프가 아니면 추가 필요 여부 판단
                if (loop < this.config.maxLoops - 1) {
                    this.throwIfAborted();
                    const needsMore = await this.checkNeedsMoreInfo(topic, allFindings, sourcesAfterScrape.length);
                    if (!needsMore) {
                        logger.info(`[DeepResearch] 루프 ${loopNumber}에서 충분한 정보 수집. 조기 종료.`);
                        break;
                    }
                }
            }

            const finalSources = deduplicateSources(Array.from(sourceMap.values()));

            // 3단계: 최종 보고서 생성 (85-100%)
            this.throwIfAborted();
            this.reportProgress(onProgress, sessionId, 'running', this.config.maxLoops, this.config.maxLoops, 'report', 85, getResearchMessage('generatingReport', this.config.language));
            const report = await this.generateReport(topic, allFindings, finalSources, subTopics, sessionId);

            await db.updateResearchSession(sessionId, {
                status: 'completed',
                progress: 100,
                summary: report.summary,
                keyFindings: report.keyFindings,
                sources: finalSources.map(source => source.url)
            });

            this.reportProgress(onProgress, sessionId, 'completed', this.config.maxLoops, this.config.maxLoops, 'completed', 100, getResearchMessage('completed', this.config.language));

            const duration = Date.now() - startTime;
            logger.info(`[DeepResearch] 완료: ${topic} (${duration}ms)`);

            return {
                sessionId,
                topic,
                summary: report.summary,
                keyFindings: report.keyFindings,
                sources: finalSources,
                totalSteps: await this.getStepCount(sessionId),
                duration
            };
        } catch (error) {
            if (error instanceof Error && error.message === 'RESEARCH_ABORTED') {
                await db.updateResearchSession(sessionId, {
                    status: 'cancelled',
                    summary: '리서치가 취소되었습니다.'
                });
                this.reportProgress(onProgress, sessionId, 'cancelled', 0, this.config.maxLoops, 'cancelled', 0, getResearchMessage('cancelled', this.config.language));
                throw error;
            }

            const errMsg = errorMessage(error);
            logger.error(`[DeepResearch] 실패: ${errMsg}`);

            await db.updateResearchSession(sessionId, {
                status: 'failed',
                summary: `리서치 실패: ${errMsg}`
            });

            this.reportProgress(onProgress, sessionId, 'failed', 0, this.config.maxLoops, 'error', 0, `오류: ${errMsg}`);

            throw error;
        } finally {
            this.abortController = null;
        }
    }

    /**
     * 주제를 서브 토픽으로 분해
     */
    private async decomposeTopics(topic: string, sessionId: string): Promise<SubTopic[]> {
        this.throwIfAborted();
        const prompt = getDecomposePrompt(this.config.language, topic);

        try {
            const response = await this.client.chat([
                { role: 'user', content: prompt }
            ], { temperature: 0.3 });
            this.throwIfAborted();

            const jsonMatch = response.content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                throw new Error(getResearchMessage('subtopicParseFailed', this.config.language));
            }

            const parsed = JSON.parse(jsonMatch[0]) as Array<{ title?: string; searchQueries?: string[]; importance?: number; searchQuery?: string }>;
            const normalized = parsed
                .map(item => {
                    const queriesFromArray = Array.isArray(item.searchQueries)
                        ? item.searchQueries.filter((query): query is string => typeof query === 'string' && query.trim().length > 0).map(query => query.trim())
                        : [];

                    const fallbackQuery = typeof item.searchQuery === 'string' && item.searchQuery.trim().length > 0
                        ? [item.searchQuery.trim()]
                        : [];

                    const mergedQueries = [...queriesFromArray, ...fallbackQuery];
                    const uniqueQueries = Array.from(new Set(mergedQueries));

                    if (!item.title || uniqueQueries.length === 0) {
                        return null;
                    }

                    return {
                        title: item.title,
                        searchQueries: uniqueQueries.slice(0, CAPACITY.RESEARCH_MAX_SEARCH_QUERIES),
                        importance: clampImportance(item.importance)
                    } satisfies SubTopic;
                })
                .filter((item): item is SubTopic => item !== null)
                .sort((a, b) => b.importance - a.importance)
                .slice(0, CAPACITY.RESEARCH_MAX_TOTAL_SOURCES);

            const finalSubTopics = normalized.length >= 8 ? normalized : buildFallbackSubTopics(topic);

            const db = getUnifiedDatabase();
            await db.addResearchStep({
                sessionId,
                stepNumber: 1,
                stepType: 'decompose',
                query: topic,
                result: JSON.stringify(finalSubTopics),
                status: 'completed'
            });

            return finalSubTopics;
        } catch (error) {
            logger.error(`[DeepResearch] 주제 분해 실패: ${errorMessage(error)}`);
            return buildFallbackSubTopics(topic);
        }
    }

    /**
     * 서브 토픽에 대해 웹 검색 수행
     */
    private async searchSubTopics(
        subTopics: SubTopic[],
        sessionId: string,
        loopNumber: number,
        sourceMap: Map<string, SearchResult>,
        seenUrls: Set<string>
    ): Promise<SearchResult[]> {
        this.throwIfAborted();
        const db = getUnifiedDatabase();
        const discoveredResults: SearchResult[] = [];

        const averageQueriesPerTopic = Math.max(
            1,
            Math.round(
                subTopics.reduce((sum, topic) => sum + topic.searchQueries.length, 0) / Math.max(subTopics.length, 1)
            )
        );

        const denominator = Math.max(subTopics.length * averageQueriesPerTopic, 1);
        const resultsPerQuery = Math.max(15, Math.ceil(this.config.maxSearchResults / denominator));

        // 모든 (서브토픽, 쿼리) 쌍을 플래팅
        const allQueries = subTopics.flatMap(st =>
            st.searchQueries.map(q => ({ subTopic: st, query: q }))
        );

        let stepIndex = 0;

        // 서브토픽 쿼리들을 병렬 실행 (동시 5개)
        await parallelBatch(
            allQueries,
            async ({ query }) => {
                this.throwIfAborted();
                if (sourceMap.size >= this.config.maxTotalSources) return;

                try {
                    const results = await performWebSearch(query, {
                        maxResults: resultsPerQuery,
                        useOllamaFirst: this.config.searchApi === 'ollama' || this.config.searchApi === 'all',
                        useFirecrawl: this.config.searchApi === 'firecrawl' || this.config.searchApi === 'all',
                        language: this.config.language
                    });

                    const uniqueForQuery: SearchResult[] = [];
                    for (const result of results) {
                        if (!result.url) continue;
                        const normalizedUrl = normalizeUrl(result.url);
                        if (seenUrls.has(normalizedUrl)) continue;

                        seenUrls.add(normalizedUrl);
                        sourceMap.set(normalizedUrl, result);
                        discoveredResults.push(result);
                        uniqueForQuery.push(result);

                        if (sourceMap.size >= this.config.maxTotalSources) break;
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
                    logger.warn(`[DeepResearch] 검색 실패 (${query}): ${errorMessage(error)}`);
                }
            },
            {
                concurrency: 5,
                signal: this.abortController?.signal
            }
        );

        return discoveredResults;
    }

    /**
     * Firecrawl로 풀 콘텐츠 스크래핑
     */
    private async scrapeSources(
        sources: SearchResult[],
        scrapedUrls: Set<string>,
        sessionId: string,
        loopNumber: number,
        onProgress: ((progress: ResearchProgress) => void) | undefined,
        progressStart: number,
        progressEnd: number
    ): Promise<void> {
        this.throwIfAborted();
        if (!this.config.scrapeFullContent) {
            return;
        }

        if (!isFirecrawlConfigured()) {
            logger.warn('[DeepResearch] Firecrawl API 키 미설정으로 스크래핑을 건너뜁니다.');
            return;
        }

        const scrapeCandidates = sources
            .filter(source => {
                if (!source.url) {
                    return false;
                }
                const normalizedUrl = normalizeUrl(source.url);
                return !scrapedUrls.has(normalizedUrl);
            })
            .slice(0, this.config.maxScrapePerLoop);

        if (scrapeCandidates.length === 0) {
            return;
        }

        const totalTarget = this.config.maxTotalSources;
        const totalToScrape = scrapeCandidates.length;
        let finished = 0;

        for (let i = 0; i < scrapeCandidates.length; i += 5) {
            this.throwIfAborted();
            const batch = scrapeCandidates.slice(i, i + 5);

            const settled = await Promise.allSettled(
                batch.map(async source => {
                    const normalizedUrl = normalizeUrl(source.url);
                    try {
                        const markdown = await this.scrapeSingleUrl(source.url);
                        if (markdown && markdown.trim().length > 0) {
                            source.fullContent = markdown;
                        }
                    } catch (error) {
                        logger.warn(`[DeepResearch] 스크래핑 실패 (${source.url}): ${errorMessage(error)}`);
                    } finally {
                        scrapedUrls.add(normalizedUrl);
                    }
                })
            );

            finished += settled.length;
            const currentProgress = progressStart + ((finished / Math.max(totalToScrape, 1)) * (progressEnd - progressStart));
            this.reportProgress(
                onProgress,
                sessionId,
                'running',
                loopNumber,
                this.config.maxLoops,
                'scrape',
                currentProgress,
                `Firecrawl 스크래핑: ${Math.min(scrapedUrls.size, totalTarget)}/${totalTarget} 소스`
            );

            logger.info(`[DeepResearch] 스크래핑 진행: ${Math.min(scrapedUrls.size, totalTarget)}/${totalTarget} 소스`);
        }

        const db = getUnifiedDatabase();
        await db.addResearchStep({
            sessionId,
            stepNumber: loopNumber * 100 + 99,
            stepType: 'search',
            query: `루프 ${loopNumber} Firecrawl 스크래핑`,
            result: `${totalToScrape}개 URL 스크래핑 완료`,
            sources: scrapeCandidates.map(item => item.url),
            status: 'completed'
        });
    }

    /**
     * 단일 URL 스크래핑
     */
    private async scrapeSingleUrl(url: string): Promise<string> {
        this.throwIfAborted();
        const { firecrawlApiUrl, firecrawlApiKey } = getConfig();

        if (!firecrawlApiKey) {
            throw new Error('FIRECRAWL_API_KEY 환경변수가 설정되지 않았습니다.');
        }

        // Abort signal 결합: 글로벌 연구 중단 + 개별 타임아웃
        const controller = new AbortController();
        const globalAbortSignal = this.abortController?.signal;
        const forwardAbort = () => controller.abort();
        if (globalAbortSignal) {
            if (globalAbortSignal.aborted) {
                throw new Error('RESEARCH_ABORTED');
            }
            globalAbortSignal.addEventListener('abort', forwardAbort);
        }
        const timeoutHandle = setTimeout(() => controller.abort(), this.config.scrapeTimeoutMs + 1000);

        try {
            const payload = await firecrawlPost({
                apiUrl: firecrawlApiUrl,
                apiKey: firecrawlApiKey,
                endpoint: '/scrape',
                data: {
                    url,
                    formats: ['markdown'],
                    onlyMainContent: true,
                    timeout: this.config.scrapeTimeoutMs
                },
                signal: controller.signal
            }) as { data?: { markdown?: string } };

            return payload.data?.markdown ?? '';
        } finally {
            if (globalAbortSignal) {
                globalAbortSignal.removeEventListener('abort', forwardAbort);
            }
            clearTimeout(timeoutHandle);
        }
    }

    /**
     * 검색 결과를 청크로 나눠 LLM 합성
     */
    private async synthesizeFindings(
        topic: string,
        searchResults: SearchResult[],
        sessionId: string,
        loopNumber: number
    ): Promise<SynthesisResult> {
        this.throwIfAborted();
        const db = getUnifiedDatabase();

        if (searchResults.length === 0) {
            return { summary: getResearchMessage('noSources', this.config.language), keyPoints: [] };
        }

        const uniqueResults = deduplicateSources(searchResults);
        const chunks = chunkArray(uniqueResults, this.config.chunkSize);

        // 청크 요약을 병렬 실행 (동시 3개 - LLM 호출이므로 적절히 제한)
        const chunkResults = await parallelBatch(
            chunks,
            async (chunk, chunkIndex) => {
                this.throwIfAborted();
                const chunkContext = chunk
                    .map(source => {
                        const sourceIndex = uniqueResults.findIndex(item => normalizeUrl(item.url) === normalizeUrl(source.url)) + 1;
                        const content = source.fullContent?.trim().length
                            ? source.fullContent
                            : source.snippet;
                        const compactContent = content.length > TRUNCATION.RESEARCH_CONTENT_MAX ? `${content.slice(0, TRUNCATION.RESEARCH_CONTENT_MAX)}\n...(중략)` : content;
                        return `[출처 ${sourceIndex}] ${source.title}\nURL: ${source.url}\n내용:\n${compactContent}`;
                    })
                    .join('\n\n');

                const chunkPrompt = getChunkSummaryPrompt(this.config.language, topic, chunkIndex, chunks.length, chunkContext);

                try {
                    const response = await this.client.chat([
                        { role: 'user', content: chunkPrompt }
                    ], { temperature: 0.35 });
                    this.throwIfAborted();
                    return response.content.trim();
                } catch (error) {
                    logger.error(`[DeepResearch] 청크 요약 실패 (${chunkIndex + 1}/${chunks.length}): ${errorMessage(error)}`);
                    return '청크 요약 실패';
                }
            },
            {
                concurrency: 3,
                signal: this.abortController?.signal
            }
        );

        const chunkSummaries = chunkResults.map(r => r ?? '청크 요약 실패');

        const mergedPrompt = getMergePrompt(this.config.language, topic, chunkSummaries);

        try {
            const response = await this.client.chat([
                { role: 'user', content: mergedPrompt }
            ], { temperature: 0.4 });
            this.throwIfAborted();

            const mergedSummary = response.content.trim();
            const keyPoints = extractBulletLikeFindings(mergedSummary);

            await db.addResearchStep({
                sessionId,
                stepNumber: loopNumber * 100 + 100,
                stepType: 'synthesize',
                query: `루프 ${loopNumber} 합성`,
                result: mergedSummary.slice(0, TRUNCATION.RESEARCH_SUMMARY_MAX),
                status: 'completed'
            });

            return { summary: mergedSummary, keyPoints };
        } catch (error) {
            logger.error(`[DeepResearch] 합성 실패: ${errorMessage(error)}`);
            return { summary: getResearchMessage('synthesisFailed', this.config.language), keyPoints: [] };
        }
    }

    /**
     * 추가 정보가 필요한지 확인
     */
    private async checkNeedsMoreInfo(
        topic: string,
        currentFindings: string[],
        sourceCount: number
    ): Promise<boolean> {
        this.throwIfAborted();
        if (sourceCount < 50) {
            return true;
        }

        const prompt = getNeedMorePrompt(this.config.language, topic, currentFindings, sourceCount);

        try {
            const response = await this.client.chat([
                { role: 'user', content: prompt }
            ], { temperature: 0.1 });
            this.throwIfAborted();

            return response.content.toLowerCase().includes('yes');
        } catch (error) {
            logger.error(`[DeepResearch] 추가 정보 판단 실패: ${errorMessage(error)}`);
            return sourceCount < this.config.maxTotalSources;
        }
    }

    /**
     * 최종 보고서 생성
     */
    private async generateReport(
        topic: string,
        findings: string[],
        sources: SearchResult[],
        subTopics: SubTopic[],
        sessionId: string
    ): Promise<{ summary: string; keyFindings: string[] }> {
        this.throwIfAborted();
        const db = getUnifiedDatabase();
        const uniqueSources = deduplicateSources(sources);

        const sourceList = uniqueSources
            .map((source, index) => `[${index + 1}] ${source.title} - ${source.url}`)
            .join('\n');

        const subTopicGuide = subTopics
            .map((subTopic, index) => `${index + 1}. ${subTopic.title}`)
            .join('\n');

        const prompt = getReportPrompt(this.config.language, topic, subTopicGuide, findings, sourceList);

        try {
            const response = await this.client.chat([
                { role: 'user', content: prompt }
            ], { temperature: 0.35 });
            this.throwIfAborted();

            const content = response.content;

            // Build regex matching all language variants for section headers
            const allSummaryHeaders = Object.values(SECTION_HEADERS).map(h => h.summary).join('|');
            const allFindingsHeaders = Object.values(SECTION_HEADERS).map(h => h.findings).join('|');
            const summaryMatch = content.match(new RegExp(`##\s*(?:${allSummaryHeaders})\s*\n([\s\S]*?)(?=##|$)`, 'i'));
            const summary = summaryMatch ? summaryMatch[1].trim() : content;

            const findingsMatch = content.match(new RegExp(`##\s*(?:${allFindingsHeaders})\s*\n([\s\S]*?)(?=##|$)`, 'i'));
            const keyFindings = findingsMatch
                ? findingsMatch[1]
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => /^\d+\./.test(line))
                    .map(line => line.replace(/^\d+\.\s*/, '').trim())
                : extractBulletLikeFindings(summary);

            await db.addResearchStep({
                sessionId,
                stepNumber: 999,
                stepType: 'report',
                query: '최종 보고서 생성',
                result: summary.slice(0, TRUNCATION.RESEARCH_SUMMARY_MAX),
                status: 'completed'
            });

            return { summary, keyFindings };
        } catch (error) {
            logger.error(`[DeepResearch] 보고서 생성 실패: ${errorMessage(error)}`);
            return { summary: getResearchMessage('reportFailed', this.config.language), keyFindings: [] };
        }
    }

    /**
     * 스텝 수 조회
     */
    private async getStepCount(sessionId: string): Promise<number> {
        const db = getUnifiedDatabase();
        const steps = await db.getResearchSteps(sessionId);
        return steps.length;
    }

    /**
     * 진행 상황 리포트
     */
    private reportProgress(
        callback: ((progress: ResearchProgress) => void) | undefined,
        sessionId: string,
        status: ResearchProgress['status'],
        currentLoop: number,
        totalLoops: number,
        currentStep: string,
        progress: number,
        message: string
    ): void {
        if (callback) {
            callback({
                sessionId,
                status,
                currentLoop,
                totalLoops,
                currentStep,
                progress,
                message
            });
        }
    }

    /**
     * 리서치 취소
     */
    cancel(): void {
        this.abortController?.abort();
    }

    private throwIfAborted(): void {
        if (this.abortController?.signal.aborted) {
            throw new Error('RESEARCH_ABORTED');
        }
    }
}

// ============================================================
// 모듈 API
// ============================================================

/**
 * 전역 설정 가져오기
 */
export function getResearchConfig(): ResearchConfig {
    return { ...globalConfig };
}

/**
 * 전역 설정 업데이트
 */
export function configureResearch(config: Partial<ResearchConfig>): ResearchConfig {
    const updated = { ...globalConfig, ...config };
    setGlobalConfig(updated);
    logger.info(`[DeepResearch] 설정 업데이트: ${JSON.stringify(updated)}`);
    return { ...updated };
}

/**
 * 서비스 인스턴스 생성
 */
export function createDeepResearchService(config?: Partial<ResearchConfig>): DeepResearchService {
    return new DeepResearchService(config);
}

/**
 * 빠른 리서치 실행 (세션 자동 생성)
 */
export async function quickResearch(
    topic: string,
    userId: string,
    depth: 'quick' | 'standard' | 'deep' = 'standard',
    onProgress?: (progress: ResearchProgress) => void
): Promise<ResearchResult> {
    const db = getUnifiedDatabase();
    const sessionId = uuidv4();

    // 세션 생성 (anonymous/guest userId는 FK 위반 방지를 위해 null 처리)
    const safeUserId = userId && userId !== 'guest' && !userId.startsWith('anon-') && userId !== 'anonymous'
        ? userId : undefined;
    await db.createResearchSession({
        id: sessionId,
        userId: safeUserId,
        topic,
        depth
    });

    // depth에 따른 maxLoops 설정
    const maxLoops = depth === 'quick' ? 1 : depth === 'standard' ? 3 : 5;

    // 리서치 실행
    const service = createDeepResearchService({ maxLoops });
    return service.executeResearch(sessionId, topic, onProgress);
}
