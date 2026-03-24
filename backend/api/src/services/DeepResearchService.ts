/**
 * ============================================================
 * DeepResearchService - 심층 연구 자동화 서비스
 * ============================================================
 *
 * ollama-deep-researcher MCP와 유사한 기능 제공:
 * - 주제 분해 → 웹 검색 → 웹 스크래핑 → 청크 합성 → 반복 루프 → 보고서 생성
 *
 * 각 단계의 구현은 deep-research/ 서브모듈에 위임하고,
 * 이 클래스는 오케스트레이션과 진행 관리만 담당합니다.
 *
 * @module services/DeepResearchService
 */

import { OllamaClient, createClient } from '../ollama/client';
import type { SearchResult } from '../mcp/web-search';
import { getConfig } from '../config/env';
import { RESEARCH_DEPTH_LOOPS } from '../config/runtime-limits';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

import {
    ResearchConfig,
    ResearchProgress,
    ResearchResult,
    globalConfig,
    setGlobalConfig
} from './deep-research-types';

import { deduplicateSources, getLoopProgressRange } from './deep-research-utils';
import { getResearchMessage } from './deep-research-prompts';

// Pipeline stage functions
import { decomposeTopics } from './deep-research/topic-decomposer';
import { searchSubTopics } from './deep-research/source-searcher';
import { scrapeSources } from './deep-research/content-scraper';
import { synthesizeFindings, checkNeedsMoreInfo } from './deep-research/findings-synthesizer';
import { generateReport } from './deep-research/report-generator';

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
            const subTopics = await decomposeTopics({
                client: this.client,
                config: this.config,
                topic,
                sessionId,
                throwIfAborted: () => this.throwIfAborted()
            });
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
            const usedQueries = new Set<string>();
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

                const newlyDiscovered = await searchSubTopics({
                    client: this.client,
                    config: this.config,
                    subTopics,
                    sessionId,
                    loopNumber,
                    sourceMap,
                    seenUrls,
                    usedQueries,
                    abortSignal: this.abortController?.signal,
                    throwIfAborted: () => this.throwIfAborted()
                });
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

                await scrapeSources({
                    sources: uniqueSources,
                    scrapedUrls,
                    config: this.config,
                    sessionId,
                    loopNumber,
                    onProgress,
                    progressStart: loopRange.scrapeStart,
                    progressEnd: loopRange.scrapeEnd,
                    abortSignal: this.abortController?.signal,
                    throwIfAborted: () => this.throwIfAborted(),
                    reportProgress: (cb, sid, status, curLoop, totalLoops, step, prog, msg) =>
                        this.reportProgress(cb, sid, status, curLoop, totalLoops, step, prog, msg)
                });
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

                const synthesis = await synthesizeFindings({
                    client: this.client,
                    config: this.config,
                    topic,
                    searchResults: sourcesAfterScrape,
                    sessionId,
                    loopNumber,
                    abortSignal: this.abortController?.signal,
                    throwIfAborted: () => this.throwIfAborted()
                });
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
                    const needsMore = await checkNeedsMoreInfo({
                        client: this.client,
                        config: this.config,
                        topic,
                        currentFindings: allFindings,
                        sourceCount: sourcesAfterScrape.length,
                        throwIfAborted: () => this.throwIfAborted()
                    });
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
            const report = await generateReport({
                client: this.client,
                config: this.config,
                topic,
                findings: allFindings,
                sources: finalSources,
                subTopics,
                sessionId,
                throwIfAborted: () => this.throwIfAborted()
            });

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

            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`[DeepResearch] 실패: ${errorMessage}`);

            await db.updateResearchSession(sessionId, {
                status: 'failed',
                summary: `리서치 실패: ${errorMessage}`
            });

            this.reportProgress(onProgress, sessionId, 'failed', 0, this.config.maxLoops, 'error', 0, `오류: ${errorMessage}`);

            throw error;
        } finally {
            this.abortController = null;
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
    const maxLoops = RESEARCH_DEPTH_LOOPS[depth] ?? RESEARCH_DEPTH_LOOPS.standard;

    // 리서치 실행
    const service = createDeepResearchService({ maxLoops });
    return service.executeResearch(sessionId, topic, onProgress);
}
