/**
 * Deep Research - 결과 합성 모듈
 *
 * 검색 결과를 청크로 나누어 LLM으로 합성하는 기능을 제공합니다.
 * 스크래핑 실패 시 경량 합성으로 자동 전환합니다.
 *
 * @module services/deep-research/findings-synthesizer
 */

import type { OllamaClient } from '../../ollama/client';
import type { SearchResult } from '../../mcp/web-search';
import type { ResearchConfig, SynthesisResult } from '../deep-research-types';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';
import { TRUNCATION, RESEARCH_DEFAULTS } from '../../config/runtime-limits';
import { LLM_TEMPERATURES } from '../../config/llm-parameters';
import { LLM_TIMEOUTS } from '../../config/timeouts';
import {
    deduplicateSources,
    normalizeUrl,
    chunkArray,
    extractBulletLikeFindings
} from '../deep-research-utils';
import {
    getChunkSummaryPrompt,
    getLightweightChunkSummaryPrompt,
    getMergePrompt,
    getNeedMorePrompt,
    getResearchMessage
} from '../deep-research-prompts';
import { parallelBatch } from '../../workflow/graph-engine';

const logger = createLogger('DeepResearch:FindingsSynthesizer');

/**
 * 소스 목록의 실질적 콘텐츠 총량을 측정합니다.
 * fullContent가 있으면 그 길이를, 없으면 snippet 길이를 합산합니다.
 */
function measureTotalContent(sources: SearchResult[]): number {
    return sources.reduce((total, source) => {
        const content = source.fullContent?.trim().length
            ? source.fullContent
            : (source.snippet || '');
        return total + content.length;
    }, 0);
}

/**
 * 검색 결과를 청크로 나눠 LLM 합성
 */
export async function synthesizeFindings(params: {
    client: OllamaClient;
    config: ResearchConfig;
    topic: string;
    searchResults: SearchResult[];
    sessionId: string;
    loopNumber: number;
    abortSignal?: AbortSignal;
    throwIfAborted: () => void;
}): Promise<SynthesisResult> {
    const { client, config, topic, searchResults, sessionId, loopNumber, abortSignal, throwIfAborted } = params;

    throwIfAborted();
    const db = getUnifiedDatabase();

    if (searchResults.length === 0) {
        return { summary: getResearchMessage('noSources', config.language), keyPoints: [] };
    }

    const uniqueResults = deduplicateSources(searchResults);

    // ── 콘텐츠 충분성 평가 ──
    const totalContentChars = measureTotalContent(uniqueResults);
    const minContentThreshold = RESEARCH_DEFAULTS.MIN_CONTENT_FOR_FULL_SYNTHESIS;
    const isLightweight = totalContentChars < minContentThreshold;

    if (isLightweight) {
        logger.warn(
            `[DeepResearch] 콘텐츠 부족 (${totalContentChars}자 < ${minContentThreshold}자) → 경량 합성 전환`
        );
    }

    const chunks = chunkArray(uniqueResults, config.chunkSize);

    // 청크 요약을 병렬 실행 (동시 3개 - LLM 호출이므로 적절히 제한)
    const chunkResults = await parallelBatch(
        chunks,
        async (chunk, chunkIndex) => {
            throwIfAborted();
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

            // 콘텐츠 충분성에 따라 프롬프트 선택
            const chunkPrompt = isLightweight
                ? getLightweightChunkSummaryPrompt(config.language, topic, chunkIndex, chunks.length, chunkContext)
                : getChunkSummaryPrompt(config.language, topic, chunkIndex, chunks.length, chunkContext);

            // 개별 청크 타임아웃 적용
            const chunkController = new AbortController();
            const timeoutHandle = setTimeout(
                () => chunkController.abort(),
                LLM_TIMEOUTS.SYNTHESIS_PER_CHUNK_TIMEOUT_MS,
            );
            // 외부 abort signal 전파
            const forwardAbort = () => chunkController.abort();
            if (abortSignal) {
                if (abortSignal.aborted) { clearTimeout(timeoutHandle); throw new Error('RESEARCH_ABORTED'); }
                abortSignal.addEventListener('abort', forwardAbort);
            }

            try {
                const response = await client.chat([
                    { role: 'user', content: chunkPrompt }
                ], { temperature: LLM_TEMPERATURES.RESEARCH_SYNTHESIS });
                throwIfAborted();
                return response.content.trim();
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                if (msg === 'RESEARCH_ABORTED') throw error;
                logger.error(`[DeepResearch] 청크 요약 실패 (${chunkIndex + 1}/${chunks.length}): ${msg}`);
                return '청크 요약 실패';
            } finally {
                clearTimeout(timeoutHandle);
                if (abortSignal) {
                    abortSignal.removeEventListener('abort', forwardAbort);
                }
            }
        },
        {
            concurrency: 3,
            signal: abortSignal
        }
    );

    const chunkSummaries = chunkResults.map(r => r ?? '청크 요약 실패');

    // 모든 청크가 실패했으면 합성 중단
    const allFailed = chunkSummaries.every(s => s === '청크 요약 실패');
    if (allFailed) {
        logger.error('[DeepResearch] 모든 청크 요약 실패 — 합성 중단');
        return { summary: getResearchMessage('synthesisFailed', config.language), keyPoints: [] };
    }

    const mergedPrompt = getMergePrompt(config.language, topic, chunkSummaries);

    try {
        const response = await client.chat([
            { role: 'user', content: mergedPrompt }
        ], { temperature: LLM_TEMPERATURES.RESEARCH_REPORT });
        throwIfAborted();

        const mergedSummary = response.content.trim();
        const keyPoints = extractBulletLikeFindings(mergedSummary);

        await db.addResearchStep({
            sessionId,
            stepNumber: loopNumber * 100 + 100,
            stepType: 'synthesize',
            query: `루프 ${loopNumber} 합성${isLightweight ? ' (경량)' : ''}`,
            result: mergedSummary.slice(0, TRUNCATION.RESEARCH_SUMMARY_MAX),
            status: 'completed'
        });

        return { summary: mergedSummary, keyPoints };
    } catch (error) {
        logger.error(`[DeepResearch] 합성 실패: ${error instanceof Error ? error.message : String(error)}`);
        return { summary: getResearchMessage('synthesisFailed', config.language), keyPoints: [] };
    }
}

/**
 * 추가 정보가 필요한지 확인
 */
export async function checkNeedsMoreInfo(params: {
    client: OllamaClient;
    config: ResearchConfig;
    topic: string;
    currentFindings: string[];
    sourceCount: number;
    throwIfAborted: () => void;
}): Promise<boolean> {
    const { client, config, topic, currentFindings, sourceCount, throwIfAborted } = params;

    throwIfAborted();
    if (sourceCount < 50) {
        return true;
    }

    const prompt = getNeedMorePrompt(config.language, topic, currentFindings, sourceCount);

    try {
        const response = await client.chat([
            { role: 'user', content: prompt }
        ], { temperature: LLM_TEMPERATURES.RESEARCH_FACT_CHECK });
        throwIfAborted();

        return response.content.toLowerCase().includes('yes');
    } catch (error) {
        logger.error(`[DeepResearch] 추가 정보 판단 실패: ${error instanceof Error ? error.message : String(error)}`);
        return sourceCount < config.maxTotalSources;
    }
}
