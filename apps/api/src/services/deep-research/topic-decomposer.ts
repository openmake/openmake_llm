/**
 * Deep Research - 주제 분해 모듈
 *
 * 주제를 서브 토픽으로 분해하는 기능을 제공합니다.
 *
 * @module services/deep-research/topic-decomposer
 */

import type { LLMClient } from '../../llm';
import type { ResearchConfig, SubTopic } from '../deep-research-types';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';
import { CAPACITY, RESEARCH_DEFAULTS } from '../../config/runtime-limits';
import { LLM_TEMPERATURES } from '../../config/llm-parameters';
import { LLM_TIMEOUTS } from '../../config/timeouts';
import { clampImportance, buildFallbackSubTopics } from '../deep-research-utils';
import { getDecomposePrompt, getResearchMessage } from '../deep-research-prompts';
import { withSkillContext } from './research-context';
import { chatWithAbortTimeout } from './chat-with-timeout';

const logger = createLogger('DeepResearch:TopicDecomposer');

/**
 * 주제를 서브 토픽으로 분해
 */
export async function decomposeTopics(params: {
    client: LLMClient;
    config: ResearchConfig;
    topic: string;
    sessionId: string;
    abortSignal?: AbortSignal;
    throwIfAborted: () => void;
    /** 활성 스킬 지식 블록 (research-context) — 있으면 프롬프트 앞에 주입 */
    skillBlock?: string;
}): Promise<SubTopic[]> {
    const { client, config, topic, sessionId, abortSignal, throwIfAborted } = params;

    throwIfAborted();
    const prompt = withSkillContext(getDecomposePrompt(config.language, topic), params.skillBlock ?? '');

    try {
        const response = await chatWithAbortTimeout(
            client,
            [{ role: 'user', content: prompt }],
            { temperature: LLM_TEMPERATURES.RESEARCH_PLAN },
            LLM_TIMEOUTS.RESEARCH_DECOMPOSE_TIMEOUT_MS,
            abortSignal,
        );
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

        // 유효 서브토픽이 최소치 이상이면 모델 결과를 채택, 아니면(파싱은 됐지만 전부 무효) 템플릿 폴백
        const useModelResult = normalized.length >= RESEARCH_DEFAULTS.MIN_SUBTOPICS;
        if (!useModelResult) {
            logger.warn(`[DeepResearch] 유효 서브토픽 ${normalized.length}개 (< ${RESEARCH_DEFAULTS.MIN_SUBTOPICS}) — 템플릿 폴백`);
        }
        const finalSubTopics = useModelResult ? normalized : buildFallbackSubTopics(topic);

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
        throwIfAborted();  // 외부 중단이면 RESEARCH_ABORTED 전파, timeout/파싱 실패면 폴백
        logger.error(`[DeepResearch] 주제 분해 실패: ${error instanceof Error ? error.message : String(error)}`);
        return buildFallbackSubTopics(topic);
    }
}
