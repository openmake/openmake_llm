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

import { OllamaClient, createClient } from '../ollama/client';
import { performWebSearch, SearchResult } from '../mcp/web-search';
import { isFirecrawlConfigured } from '../mcp/firecrawl';
import { getConfig } from '../config/env';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('DeepResearchService');

// ============================================================
// 타입 정의
// ============================================================

/** 리서치 설정 */
export interface ResearchConfig {
    maxLoops: number;            // 최대 반복 횟수 (기본: 5)
    llmModel: string;            // 사용할 LLM 모델
    searchApi: 'ollama' | 'firecrawl' | 'google' | 'all'; // 검색 API
    maxSearchResults: number;    // 검색 결과 예산 (기본: 360)
    language: 'ko' | 'en';       // 출력 언어
    maxTotalSources: number;     // 목표 고유 소스 수 (기본: 80)
    scrapeFullContent: boolean;  // Firecrawl로 풀 콘텐츠 스크래핑 여부 (기본: true)
    maxScrapePerLoop: number;    // 루프당 최대 스크래핑 수 (기본: 15)
    scrapeTimeoutMs: number;     // 개별 스크래핑 타임아웃 (기본: 15000)
    chunkSize: number;           // 중간 요약용 청크 사이즈 (기본: 10)
}

/** 리서치 진행 상황 */
export interface ResearchProgress {
    sessionId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    currentLoop: number;
    totalLoops: number;
    currentStep: string;
    progress: number; // 0-100
    message: string;
}

/** 리서치 결과 */
export interface ResearchResult {
    sessionId: string;
    topic: string;
    summary: string;
    keyFindings: string[];
    sources: SearchResult[];
    totalSteps: number;
    duration: number; // ms
}

/** 서브 토픽 */
interface SubTopic {
    title: string;
    searchQueries: string[];
    importance: number; // 1-5
}

interface SynthesisResult {
    summary: string;
    keyPoints: string[];
}

// ============================================================
// 기본 설정
// ============================================================

const DEFAULT_CONFIG: ResearchConfig = {
    maxLoops: 5,
    llmModel: 'gemma3:4b',
    searchApi: 'all',
    maxSearchResults: 360,
    language: 'ko',
    maxTotalSources: 80,
    scrapeFullContent: true,
    maxScrapePerLoop: 15,
    scrapeTimeoutMs: 15000,
    chunkSize: 10
};

// 전역 설정 (configure로 변경 가능)
let globalConfig: ResearchConfig = { ...DEFAULT_CONFIG };

// ============================================================
// DeepResearchService 클래스
// ============================================================

export class DeepResearchService {
    private client: OllamaClient;
    private config: ResearchConfig;
    private abortController: AbortController | null = null;

    constructor(config?: Partial<ResearchConfig>) {
        this.config = { ...globalConfig, ...config };
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

        logger.info(`[DeepResearch] 시작: ${topic} (세션: ${sessionId})`);

        try {
            await db.updateResearchSession(sessionId, { status: 'running', progress: 0 });
            this.reportProgress(onProgress, sessionId, 'running', 0, this.config.maxLoops, '초기화', 0, '리서치를 시작합니다...');

            // 1단계: 주제 분해 (0-5%)
            this.reportProgress(onProgress, sessionId, 'running', 0, this.config.maxLoops, 'decompose', 2, '주제를 분석 중...');
            const subTopics = await this.decomposeTopics(topic, sessionId);
            await db.updateResearchSession(sessionId, { progress: 5 });
            this.reportProgress(onProgress, sessionId, 'running', 0, this.config.maxLoops, 'decompose', 5, `${subTopics.length}개 서브 토픽 추출 완료`);

            // 2단계: 반복 리서치 루프 (5-85%)
            const sourceMap = new Map<string, SearchResult>();
            const seenUrls = new Set<string>();
            const scrapedUrls = new Set<string>();
            const allFindings: string[] = [];

            for (let loop = 0; loop < this.config.maxLoops; loop++) {
                const loopNumber = loop + 1;
                const loopRange = this.getLoopProgressRange(loop);

                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'search',
                    loopRange.searchStart,
                    `루프 ${loopNumber}: 웹 검색 중...`
                );

                const newlyDiscovered = await this.searchSubTopics(
                    subTopics,
                    sessionId,
                    loopNumber,
                    sourceMap,
                    seenUrls
                );

                const uniqueSources = Array.from(sourceMap.values());
                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'search',
                    loopRange.searchEnd,
                    `루프 ${loopNumber}: 검색 완료 (${newlyDiscovered.length}개 신규, 누적 ${uniqueSources.length}/${this.config.maxTotalSources} 소스)`
                );

                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'scrape',
                    loopRange.scrapeStart,
                    `루프 ${loopNumber}: Firecrawl 스크래핑 준비 (${scrapedUrls.size}/${this.config.maxTotalSources} 소스)`
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

                const sourcesAfterScrape = Array.from(sourceMap.values());

                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'synthesize',
                    loopRange.synthesizeStart,
                    `루프 ${loopNumber}: 정보 합성 중...`
                );

                const synthesis = await this.synthesizeFindings(topic, sourcesAfterScrape, sessionId, loopNumber);
                allFindings.push(synthesis.summary);

                this.reportProgress(
                    onProgress,
                    sessionId,
                    'running',
                    loopNumber,
                    this.config.maxLoops,
                    'synthesize',
                    loopRange.synthesizeEnd,
                    `루프 ${loopNumber}: 합성 완료 (${sourcesAfterScrape.length}개 소스 반영)`
                );

                await db.updateResearchSession(sessionId, { progress: Math.round(loopRange.synthesizeEnd) });

                // 목표 소스 수 도달 시 조기 종료
                if (sourcesAfterScrape.length >= this.config.maxTotalSources) {
                    logger.info(`[DeepResearch] 목표 소스 수 도달 (${sourcesAfterScrape.length}/${this.config.maxTotalSources}). 조기 종료.`);
                    break;
                }

                // 마지막 루프가 아니면 추가 필요 여부 판단
                if (loop < this.config.maxLoops - 1) {
                    const needsMore = await this.checkNeedsMoreInfo(topic, allFindings, sourcesAfterScrape.length);
                    if (!needsMore) {
                        logger.info(`[DeepResearch] 루프 ${loopNumber}에서 충분한 정보 수집. 조기 종료.`);
                        break;
                    }
                }
            }

            const finalSources = this.deduplicateSources(Array.from(sourceMap.values()));

            // 3단계: 최종 보고서 생성 (85-100%)
            this.reportProgress(onProgress, sessionId, 'running', this.config.maxLoops, this.config.maxLoops, 'report', 85, '최종 보고서 생성 중...');
            const report = await this.generateReport(topic, allFindings, finalSources, subTopics, sessionId);

            await db.updateResearchSession(sessionId, {
                status: 'completed',
                progress: 100,
                summary: report.summary,
                keyFindings: report.keyFindings,
                sources: finalSources.map(source => source.url)
            });

            this.reportProgress(onProgress, sessionId, 'completed', this.config.maxLoops, this.config.maxLoops, 'completed', 100, '리서치 완료!');

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
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`[DeepResearch] 실패: ${errorMessage}`);

            await db.updateResearchSession(sessionId, {
                status: 'failed',
                summary: `리서치 실패: ${errorMessage}`
            });

            this.reportProgress(onProgress, sessionId, 'failed', 0, this.config.maxLoops, 'error', 0, `오류: ${errorMessage}`);

            throw error;
        }
    }

    /**
     * 주제를 서브 토픽으로 분해
     */
    private async decomposeTopics(topic: string, sessionId: string): Promise<SubTopic[]> {
        const prompt = this.config.language === 'ko'
            ? `다음 주제를 심층 연구하기 위해 8-15개의 서브 토픽을 생성하세요.
주제: ${topic}

요구사항:
1) 각 서브 토픽마다 서로 다른 관점의 검색어 2-3개를 만드세요.
2) 중요도는 1-5 정수로 부여하세요.
3) JSON 배열만 출력하세요. 설명 문장 금지.

반드시 다음 형식:
[
  {
    "title": "서브 토픽 제목",
    "searchQueries": ["검색어 1", "검색어 2", "검색어 3"],
    "importance": 5
  }
]`
            : `Generate 8-15 subtopics for deep research on this topic.
Topic: ${topic}

Requirements:
1) Each subtopic must include 2-3 diverse search queries.
2) importance must be an integer from 1-5.
3) Output JSON array only with no additional text.

Required format:
[
  {
    "title": "Subtopic title",
    "searchQueries": ["query 1", "query 2", "query 3"],
    "importance": 5
  }
]`;

        try {
            const response = await this.client.chat([
                { role: 'user', content: prompt }
            ], { temperature: 0.3 });

            const jsonMatch = response.content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                throw new Error('서브 토픽 JSON 파싱 실패');
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
                        searchQueries: uniqueQueries.slice(0, 3),
                        importance: this.clampImportance(item.importance)
                    } satisfies SubTopic;
                })
                .filter((item): item is SubTopic => item !== null)
                .sort((a, b) => b.importance - a.importance)
                .slice(0, 15);

            const finalSubTopics = normalized.length >= 8 ? normalized : this.buildFallbackSubTopics(topic);

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
            logger.error(`[DeepResearch] 주제 분해 실패: ${error instanceof Error ? error.message : String(error)}`);
            return this.buildFallbackSubTopics(topic);
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

        let stepIndex = 0;

        for (const subTopic of subTopics) {
            for (const query of subTopic.searchQueries) {
                try {
                    const results = await performWebSearch(query, {
                        maxResults: resultsPerQuery,
                        useOllamaFirst: this.config.searchApi === 'ollama' || this.config.searchApi === 'all',
                        useFirecrawl: this.config.searchApi === 'firecrawl' || this.config.searchApi === 'all'
                    });

                    const uniqueForQuery: SearchResult[] = [];
                    for (const result of results) {
                        if (!result.url) {
                            continue;
                        }

                        const normalizedUrl = this.normalizeUrl(result.url);
                        if (seenUrls.has(normalizedUrl)) {
                            continue;
                        }

                        seenUrls.add(normalizedUrl);
                        sourceMap.set(normalizedUrl, result);
                        discoveredResults.push(result);
                        uniqueForQuery.push(result);

                        if (sourceMap.size >= this.config.maxTotalSources) {
                            break;
                        }
                    }

                    await db.addResearchStep({
                        sessionId,
                        stepNumber: loopNumber * 100 + (++stepIndex),
                        stepType: 'search',
                        query,
                        result: `${results.length}개 검색, ${uniqueForQuery.length}개 신규 확보`,
                        sources: uniqueForQuery.slice(0, 10).map(item => item.url),
                        status: 'completed'
                    });

                    if (sourceMap.size >= this.config.maxTotalSources) {
                        return discoveredResults;
                    }
                } catch (error) {
                    logger.warn(`[DeepResearch] 검색 실패 (${query}): ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }

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
                const normalizedUrl = this.normalizeUrl(source.url);
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
            const batch = scrapeCandidates.slice(i, i + 5);

            const settled = await Promise.allSettled(
                batch.map(async source => {
                    const normalizedUrl = this.normalizeUrl(source.url);
                    try {
                        const markdown = await this.scrapeSingleUrl(source.url);
                        if (markdown && markdown.trim().length > 0) {
                            source.fullContent = markdown;
                        }
                    } catch (error) {
                        logger.warn(`[DeepResearch] 스크래핑 실패 (${source.url}): ${error instanceof Error ? error.message : String(error)}`);
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
        const { firecrawlApiUrl, firecrawlApiKey } = getConfig();

        if (!firecrawlApiKey) {
            throw new Error('FIRECRAWL_API_KEY 환경변수가 설정되지 않았습니다.');
        }

        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), this.config.scrapeTimeoutMs + 1000);

        try {
            const response = await fetch(`${firecrawlApiUrl}/scrape`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${firecrawlApiKey}`
                },
                body: JSON.stringify({
                    url,
                    formats: ['markdown'],
                    onlyMainContent: true,
                    timeout: this.config.scrapeTimeoutMs
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Firecrawl /scrape 오류 (${response.status}): ${errorText}`);
            }

            const payload = await response.json() as { data?: { markdown?: string } };
            return payload.data?.markdown ?? '';
        } finally {
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
        const db = getUnifiedDatabase();

        if (searchResults.length === 0) {
            return { summary: '수집된 소스가 없습니다.', keyPoints: [] };
        }

        const uniqueResults = this.deduplicateSources(searchResults);
        const chunks = this.chunkArray(uniqueResults, this.config.chunkSize);
        const chunkSummaries: string[] = [];

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            const chunk = chunks[chunkIndex];
            const chunkContext = chunk
                .map(source => {
                    const sourceIndex = uniqueResults.findIndex(item => this.normalizeUrl(item.url) === this.normalizeUrl(source.url)) + 1;
                    const content = source.fullContent?.trim().length
                        ? source.fullContent
                        : source.snippet;
                    const compactContent = content.length > 5000 ? `${content.slice(0, 5000)}\n...(중략)` : content;

                    return `[출처 ${sourceIndex}] ${source.title}\nURL: ${source.url}\n내용:\n${compactContent}`;
                })
                .join('\n\n');

            const chunkPrompt = this.config.language === 'ko'
                ? `다음은 "${topic}" 연구용 소스 청크(${chunkIndex + 1}/${chunks.length})입니다.

요구사항:
1) 800-1200 단어로 중간 요약을 작성하세요.
2) 핵심 주장마다 반드시 [출처 N] 형식의 인용을 포함하세요.
3) 불확실한 정보는 단정하지 말고 출처 근거 중심으로 작성하세요.

소스:
${chunkContext}`
                : `This is a source chunk (${chunkIndex + 1}/${chunks.length}) for research on "${topic}".

Requirements:
1) Write an intermediate summary in 800-1200 words.
2) Include citations in [출처 N] format for key claims.
3) Keep evidence-driven language and avoid unsupported certainty.

Sources:
${chunkContext}`;

            try {
                const response = await this.client.chat([
                    { role: 'user', content: chunkPrompt }
                ], { temperature: 0.35 });
                chunkSummaries.push(response.content.trim());
            } catch (error) {
                logger.error(`[DeepResearch] 청크 요약 실패 (${chunkIndex + 1}/${chunks.length}): ${error instanceof Error ? error.message : String(error)}`);
                chunkSummaries.push('청크 요약 실패');
            }
        }

        const mergedPrompt = this.config.language === 'ko'
            ? `다음은 "${topic}" 연구의 중간 요약들입니다.

요구사항:
1) 모든 중간 요약을 통합해 2000-3000 단어의 종합 합성문을 작성하세요.
2) 핵심 주장마다 [출처 N] 형식의 인용을 반드시 포함하세요.
3) 반복을 줄이고, 주제별 구조를 명확히 정리하세요.

중간 요약:
${chunkSummaries.map((summary, index) => `### 청크 ${index + 1}\n${summary}`).join('\n\n')}`
            : `Below are intermediate summaries for research on "${topic}".

Requirements:
1) Merge all summaries into a 2000-3000 word synthesis.
2) Keep inline citations in [출처 N] format for key claims.
3) Reduce repetition and present a clear thematic structure.

Intermediate summaries:
${chunkSummaries.map((summary, index) => `### Chunk ${index + 1}\n${summary}`).join('\n\n')}`;

        try {
            const response = await this.client.chat([
                { role: 'user', content: mergedPrompt }
            ], { temperature: 0.4 });

            const mergedSummary = response.content.trim();
            const keyPoints = this.extractBulletLikeFindings(mergedSummary);

            await db.addResearchStep({
                sessionId,
                stepNumber: loopNumber * 100 + 100,
                stepType: 'synthesize',
                query: `루프 ${loopNumber} 합성`,
                result: mergedSummary.slice(0, 4000),
                status: 'completed'
            });

            return { summary: mergedSummary, keyPoints };
        } catch (error) {
            logger.error(`[DeepResearch] 합성 실패: ${error instanceof Error ? error.message : String(error)}`);
            return { summary: '합성 실패', keyPoints: [] };
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
        if (sourceCount < 50) {
            return true;
        }

        const prompt = this.config.language === 'ko'
            ? `"${topic}" 연구에서 현재까지 수집된 합성 결과는 아래와 같습니다.

${currentFindings.join('\n\n---\n\n')}

현재 고유 소스 수: ${sourceCount}

질문: 아직 추가 탐색이 필요한가요? "yes" 또는 "no"로만 답하세요.`
            : `The following synthesis has been collected for research on "${topic}".

${currentFindings.join('\n\n---\n\n')}

Current unique source count: ${sourceCount}

Question: Is more exploration needed? Answer only "yes" or "no".`;

        try {
            const response = await this.client.chat([
                { role: 'user', content: prompt }
            ], { temperature: 0.1 });

            return response.content.toLowerCase().includes('yes');
        } catch (error) {
            logger.error(`[DeepResearch] 추가 정보 판단 실패: ${error instanceof Error ? error.message : String(error)}`);
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
        const db = getUnifiedDatabase();
        const uniqueSources = this.deduplicateSources(sources);

        const sourceList = uniqueSources
            .map((source, index) => `[${index + 1}] ${source.title} - ${source.url}`)
            .join('\n');

        const subTopicGuide = subTopics
            .map((subTopic, index) => `${index + 1}. ${subTopic.title}`)
            .join('\n');

        const prompt = this.config.language === 'ko'
            ? `"${topic}"에 대한 심층 연구 최종 보고서를 작성하세요.

절대 축약하지 마세요. 충분히 상세하게 작성하세요. 모든 출처를 인용하세요.

출력 요구사항:
1) 종합 요약: 500-800 단어
2) 주요 발견사항: 10-20개 번호 목록, 각 항목은 2-3문장
3) 상세 분석: 아래 서브 토픽 구조를 기반으로 총 3000-5000 단어
4) 참고 자료: 모든 고유 소스를 번호 목록으로 작성 ([N] Title - URL)
5) 본문 모든 핵심 주장에 [출처 N] 형태의 인라인 인용 포함

서브 토픽 구조:
${subTopicGuide}

중간 합성 결과:
${findings.join('\n\n---\n\n')}

전체 소스 목록:
${sourceList}

다음 섹션 헤더를 유지하세요:
## 종합 요약
## 주요 발견사항
## 상세 분석
## 참고 자료`
            : `Write a final deep-research report on "${topic}".

Do not abbreviate. Write with full detail. Cite all sources.

Output requirements:
1) Comprehensive summary: 500-800 words
2) Key findings: 10-20 numbered findings, each 2-3 sentences
3) Detailed analysis: 3000-5000 words total, structured by the subtopics below
4) References: all unique sources as numbered list ([N] Title - URL)
5) Inline citations in [출처 N] format for all core claims

Subtopic structure:
${subTopicGuide}

Intermediate synthesis:
${findings.join('\n\n---\n\n')}

Full source list:
${sourceList}

Keep these section headers:
## 종합 요약
## 주요 발견사항
## 상세 분석
## 참고 자료`;

        try {
            const response = await this.client.chat([
                { role: 'user', content: prompt }
            ], { temperature: 0.35 });

            const content = response.content;

            const summaryMatch = content.match(/##\s*종합 요약\s*\n([\s\S]*?)(?=##|$)/i);
            const summary = summaryMatch ? summaryMatch[1].trim() : content;

            const findingsMatch = content.match(/##\s*주요 발견사항\s*\n([\s\S]*?)(?=##|$)/i);
            const keyFindings = findingsMatch
                ? findingsMatch[1]
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => /^\d+\./.test(line))
                    .map(line => line.replace(/^\d+\.\s*/, '').trim())
                : this.extractBulletLikeFindings(summary);

            await db.addResearchStep({
                sessionId,
                stepNumber: 999,
                stepType: 'report',
                query: '최종 보고서 생성',
                result: summary.slice(0, 4000),
                status: 'completed'
            });

            return { summary, keyFindings };
        } catch (error) {
            logger.error(`[DeepResearch] 보고서 생성 실패: ${error instanceof Error ? error.message : String(error)}`);
            return { summary: '보고서 생성 실패', keyFindings: [] };
        }
    }

    /**
     * 중복 소스 제거
     */
    private deduplicateSources(sources: SearchResult[]): SearchResult[] {
        const seen = new Set<string>();
        return sources.filter(source => {
            const normalizedUrl = this.normalizeUrl(source.url);
            if (seen.has(normalizedUrl)) {
                return false;
            }
            seen.add(normalizedUrl);
            return true;
        });
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
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    private normalizeUrl(url: string): string {
        return url
            .trim()
            .replace(/\/$/, '')
            .replace(/^https?:\/\//, '')
            .toLowerCase();
    }

    private clampImportance(value: number | undefined): number {
        if (typeof value !== 'number' || Number.isNaN(value)) {
            return 3;
        }
        return Math.max(1, Math.min(5, Math.round(value)));
    }

    private buildFallbackSubTopics(topic: string): SubTopic[] {
        return [
            {
                title: `${topic} 개요 및 정의`,
                searchQueries: [`${topic} 개요`, `${topic} 정의`, `${topic} 배경`],
                importance: 5
            },
            {
                title: `${topic} 최신 동향`,
                searchQueries: [`${topic} 최신 동향`, `${topic} 2025 트렌드`, `${topic} recent updates`],
                importance: 5
            },
            {
                title: `${topic} 기술/구조 분석`,
                searchQueries: [`${topic} 구조`, `${topic} architecture`, `${topic} technical analysis`],
                importance: 4
            },
            {
                title: `${topic} 시장 및 산업 영향`,
                searchQueries: [`${topic} 시장 규모`, `${topic} 산업 영향`, `${topic} market report`],
                importance: 4
            },
            {
                title: `${topic} 주요 사례`,
                searchQueries: [`${topic} 사례`, `${topic} case study`, `${topic} 성공 사례`],
                importance: 4
            },
            {
                title: `${topic} 리스크와 한계`,
                searchQueries: [`${topic} 한계`, `${topic} 리스크`, `${topic} 문제점`],
                importance: 3
            },
            {
                title: `${topic} 규제 및 정책`,
                searchQueries: [`${topic} 규제`, `${topic} 정책`, `${topic} 법률`],
                importance: 3
            },
            {
                title: `${topic} 향후 전망`,
                searchQueries: [`${topic} 전망`, `${topic} future outlook`, `${topic} 예측`],
                importance: 3
            }
        ];
    }

    private chunkArray<T>(items: T[], chunkSize: number): T[][] {
        const safeChunkSize = Math.max(1, chunkSize);
        const chunks: T[][] = [];
        for (let i = 0; i < items.length; i += safeChunkSize) {
            chunks.push(items.slice(i, i + safeChunkSize));
        }
        return chunks;
    }

    private extractBulletLikeFindings(text: string): string[] {
        return text
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('- ') || /^\d+\./.test(line))
            .map(line => line.replace(/^[-\d.\s]+/, '').trim())
            .filter(line => line.length > 0)
            .slice(0, 20);
    }

    private getLoopProgressRange(loopIndex: number): {
        searchStart: number;
        searchEnd: number;
        scrapeStart: number;
        scrapeEnd: number;
        synthStart: number;
        synthesizeStart: number;
        synthesizeEnd: number;
    } {
        const loopSpan = 80 / this.config.maxLoops;
        const loopBase = 5 + (loopIndex * loopSpan);
        const searchEnd = loopBase + (loopSpan / 3);
        const scrapeEnd = loopBase + ((loopSpan / 3) * 2);
        const synthEnd = loopBase + loopSpan;

        return {
            searchStart: loopBase,
            searchEnd,
            scrapeStart: searchEnd,
            scrapeEnd,
            synthStart: scrapeEnd,
            synthesizeStart: scrapeEnd,
            synthesizeEnd: synthEnd
        };
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
    globalConfig = { ...globalConfig, ...config };
    logger.info(`[DeepResearch] 설정 업데이트: ${JSON.stringify(globalConfig)}`);
    return { ...globalConfig };
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
