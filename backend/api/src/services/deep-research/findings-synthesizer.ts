/**
 * Deep Research - 결과 합성 모듈
 *
 * 검색 결과를 청크로 나누어 LLM으로 합성하는 기능을 제공합니다.
 *
 * @module services/deep-research/findings-synthesizer
 */

import type { OllamaClient } from '../../ollama/client';
import type { SearchResult } from '../../mcp/web-search';
import type { ResearchConfig, SynthesisResult } from '../deep-research-types';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';
import { TRUNCATION } from '../../config/runtime-limits';
import { LLM_TEMPERATURES } from '../../config/llm-parameters';
import {
    deduplicateSources,
    normalizeUrl,
    chunkArray,
    extractBulletLikeFindings
} from '../deep-research-utils';
import {
    getChunkSummaryPrompt,
    getMergePrompt,
    getNeedMorePrompt,
    getResearchMessage
} from '../deep-research-prompts';
import { parallelBatch } from '../../workflow/graph-engine';

const logger = createLogger('DeepResearch:FindingsSynthesizer');

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

            const chunkPrompt = getChunkSummaryPrompt(config.language, topic, chunkIndex, chunks.length, chunkContext);

            try {
                const response = await client.chat([
                    { role: 'user', content: chunkPrompt }
                ], { temperature: LLM_TEMPERATURES.RESEARCH_SYNTHESIS });
                throwIfAborted();
                return response.content.trim();
            } catch (error) {
                logger.error(`[DeepResearch] 청크 요약 실패 (${chunkIndex + 1}/${chunks.length}): ${error instanceof Error ? error.message : String(error)}`);
                return '청크 요약 실패';
            }
        },
        {
            concurrency: 3,
            signal: abortSignal
        }
    );

    const chunkSummaries = chunkResults.map(r => r ?? '청크 요약 실패');

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
            query: `루프 ${loopNumber} 합성`,
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
