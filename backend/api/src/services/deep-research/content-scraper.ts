/**
 * Deep Research - 콘텐츠 스크래핑 모듈
 *
 * 무료 웹 스크래퍼를 사용한 웹 페이지 스크래핑 기능을 제공합니다.
 *
 * @module services/deep-research/content-scraper
 */

import type { SearchResult } from '../../mcp/web-search';
import type { ResearchConfig, ResearchProgress } from '../deep-research-types';
import { scrapePage } from '../../utils/web-scraper';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';
import { RESEARCH_DEFAULTS } from '../../config/runtime-limits';
import { normalizeUrl } from '../deep-research-utils';

const logger = createLogger('DeepResearch:ContentScraper');

/**
 * 단일 URL 스크래핑
 */
export async function scrapeSingleUrl(params: {
    url: string;
    config: ResearchConfig;
    abortSignal?: AbortSignal;
    throwIfAborted: () => void;
}): Promise<string> {
    const { url, config, abortSignal, throwIfAborted } = params;

    throwIfAborted();

    // Abort signal 결합: 글로벌 연구 중단 + 개별 타임아웃
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    if (abortSignal) {
        if (abortSignal.aborted) {
            throw new Error('RESEARCH_ABORTED');
        }
        abortSignal.addEventListener('abort', forwardAbort);
    }
    const timeoutHandle = setTimeout(() => controller.abort(), config.scrapeTimeoutMs + 1000);

    try {
        const result = await scrapePage(url, {
            onlyMainContent: true,
            timeoutMs: config.scrapeTimeoutMs,
            signal: controller.signal,
        });

        return result.markdown;
    } finally {
        if (abortSignal) {
            abortSignal.removeEventListener('abort', forwardAbort);
        }
        clearTimeout(timeoutHandle);
    }
}

/**
 * 풀 콘텐츠 스크래핑
 */
export async function scrapeSources(params: {
    sources: SearchResult[];
    scrapedUrls: Set<string>;
    config: ResearchConfig;
    sessionId: string;
    loopNumber: number;
    onProgress: ((progress: ResearchProgress) => void) | undefined;
    progressStart: number;
    progressEnd: number;
    abortSignal?: AbortSignal;
    throwIfAborted: () => void;
    reportProgress: (
        callback: ((progress: ResearchProgress) => void) | undefined,
        sessionId: string,
        status: ResearchProgress['status'],
        currentLoop: number,
        totalLoops: number,
        currentStep: string,
        progress: number,
        message: string
    ) => void;
}): Promise<void> {
    const {
        sources, scrapedUrls, config, sessionId, loopNumber,
        onProgress, progressStart, progressEnd,
        abortSignal, throwIfAborted, reportProgress
    } = params;

    throwIfAborted();
    if (!config.scrapeFullContent) {
        return;
    }

    const scrapeCandidates = sources
        .filter(source => {
            if (!source.url) {
                return false;
            }
            const normalizedUrl_ = normalizeUrl(source.url);
            return !scrapedUrls.has(normalizedUrl_);
        })
        .slice(0, config.maxScrapePerLoop);

    if (scrapeCandidates.length === 0) {
        return;
    }

    const totalTarget = config.maxTotalSources;
    const totalToScrape = scrapeCandidates.length;
    let finished = 0;

    const batchSize = RESEARCH_DEFAULTS.SCRAPE_BATCH_SIZE;
    for (let i = 0; i < scrapeCandidates.length; i += batchSize) {
        throwIfAborted();
        const batch = scrapeCandidates.slice(i, i + batchSize);

        const settled = await Promise.allSettled(
            batch.map(async source => {
                const normalizedUrl_ = normalizeUrl(source.url);
                try {
                    const markdown = await scrapeSingleUrl({
                        url: source.url,
                        config,
                        abortSignal,
                        throwIfAborted
                    });
                    if (markdown && markdown.trim().length > 0) {
                        source.fullContent = markdown;
                    }
                } catch (error) {
                    logger.warn(`[DeepResearch] 스크래핑 실패 (${source.url}): ${error instanceof Error ? error.message : String(error)}`);
                } finally {
                    scrapedUrls.add(normalizedUrl_);
                }
            })
        );

        finished += settled.length;
        const currentProgress = progressStart + ((finished / Math.max(totalToScrape, 1)) * (progressEnd - progressStart));
        reportProgress(
            onProgress,
            sessionId,
            'running',
            loopNumber,
            config.maxLoops,
            'scrape',
            currentProgress,
            `웹 스크래핑: ${Math.min(scrapedUrls.size, totalTarget)}/${totalTarget} 소스`
        );

        logger.info(`[DeepResearch] 스크래핑 진행: ${Math.min(scrapedUrls.size, totalTarget)}/${totalTarget} 소스`);
    }

    const db = getUnifiedDatabase();
    await db.addResearchStep({
        sessionId,
        stepNumber: loopNumber * 100 + 99,
        stepType: 'search',
        query: `루프 ${loopNumber} 웹 스크래핑`,
        result: `${totalToScrape}개 URL 스크래핑 완료`,
        sources: scrapeCandidates.map(item => item.url),
        status: 'completed'
    });
}
