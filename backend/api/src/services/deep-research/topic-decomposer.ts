/**
 * Deep Research - 주제 분해 모듈
 *
 * 주제를 서브 토픽으로 분해하는 기능을 제공합니다.
 *
 * @module services/deep-research/topic-decomposer
 */

import type { OllamaClient } from '../../ollama/client';
import type { ResearchConfig, SubTopic } from '../deep-research-types';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';
import { CAPACITY } from '../../config/runtime-limits';
import { LLM_TEMPERATURES } from '../../config/llm-parameters';
import { clampImportance, buildFallbackSubTopics } from '../deep-research-utils';
import { getDecomposePrompt, getResearchMessage } from '../deep-research-prompts';

const logger = createLogger('DeepResearch:TopicDecomposer');

/**
 * 주제를 서브 토픽으로 분해
 */
export async function decomposeTopics(params: {
    client: OllamaClient;
    config: ResearchConfig;
    topic: string;
    sessionId: string;
    throwIfAborted: () => void;
}): Promise<SubTopic[]> {
    const { client, config, topic, sessionId, throwIfAborted } = params;

    throwIfAborted();
    const prompt = getDecomposePrompt(config.language, topic);

    try {
        const response = await client.chat([
            { role: 'user', content: prompt }
        ], { temperature: LLM_TEMPERATURES.RESEARCH_PLAN });
        throwIfAborted();

        const jsonMatch = response.content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            throw new Error(getResearchMessage('subtopicParseFailed', config.language));
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
        logger.error(`[DeepResearch] 주제 분해 실패: ${error instanceof Error ? error.message : String(error)}`);
        return buildFallbackSubTopics(topic);
    }
}
