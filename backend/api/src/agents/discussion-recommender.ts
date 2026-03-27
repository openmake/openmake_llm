/**
 * ============================================================
 * 토론용 관련 에이전트 추천 모듈
 * ============================================================
 *
 * 토론 엔진에서 사용할 다양한 관점의 에이전트를 추천한다.
 *
 * @module agents/discussion-recommender
 */

import { Agent } from './types';
import { industryData, getAgentById } from './agent-data';
import { analyzeTopicIntent } from './topic-analyzer';
import { routeToAgent } from './keyword-router';
import { DISCUSSION_DOMAIN_CATEGORIES, DISCUSSION_COMPLEMENTARY_AGENTS } from '../config/runtime-limits';

/**
 * 토론용 관련 에이전트 추천 (토픽+키워드 라우팅 + 컨텍스트 반영)
 *
 * 토론 엔진에서 사용할 다양한 관점의 에이전트를 추천한다.
 * 4단계 에이전트 수집 전략:
 *
 * 1. 주요 에이전트: 토픽+키워드 라우팅으로 선택된 최적 에이전트
 * 2. 의도 분석 기반: analyzeTopicIntent 결과의 suggestedAgents
 * 3. 같은 카테고리: 주요 에이전트와 같은 카테고리의 다른 에이전트
 * 4. 보완적 에이전트: 도메인별 차별화
 *    - 기술 질문: software-engineer, devops-engineer, ai-ml-engineer 등
 *    - 비즈니스 질문: business-strategist, financial-analyst 등
 *    - 혼합/미분류: 다양한 관점 (business, data, project-manager)
 *
 * @param message - 사용자 메시지
 * @param count - 최대 반환 에이전트 수 (기본값: 10, 0이면 전체)
 * @param context - 추가 컨텍스트 (문서 내용 등, 선택적)
 * @returns {Promise<Agent[]>} - 추천 에이전트 배열 (중복 제거됨)
 */
export async function getRelatedAgentsForDiscussion(
    message: string,
    count: number = 10,
    context?: string
): Promise<Agent[]> {
    // 🆕 토픽 분석에는 컨텍스트 포함 (분류 정확도 향상)
    // "Context:" 레이블은 LLM 분류기 내부 입력이므로 영어로 통일 (다국어 사용자 무관)
    const fullText = context ? `${message}\n\nContext: ${context}` : message;
    const topicAnalysis = analyzeTopicIntent(fullText);

    // 토픽+키워드 라우팅으로 주요 에이전트 선택
    const selection = await routeToAgent(message);

    const result: Agent[] = [];
    const usedIds = new Set<string>();

    // 1. 주요 에이전트 추가 (토픽+키워드 라우팅 선택 우선)
    const primaryAgent = getAgentById(selection.primaryAgent);
    if (primaryAgent && primaryAgent.id !== 'general') {
        result.push(primaryAgent);
        usedIds.add(primaryAgent.id);
    }

    // 2. 의도 분석 기반 에이전트 추가
    for (const agentId of topicAnalysis.suggestedAgents) {
        if (usedIds.has(agentId)) continue;
        const agent = getAgentById(agentId);
        if (agent) {
            result.push(agent);
            usedIds.add(agentId);
        }
    }

    // 3. 같은 카테고리의 다른 에이전트 추가
    if (selection.category && selection.category !== 'general') {
        const categoryData = industryData[selection.category];
        if (categoryData) {
            for (const agent of categoryData.agents) {
                if (usedIds.has(agent.id)) continue;
                result.push({
                    ...agent,
                    emoji: categoryData.icon,
                    category: selection.category
                });
                usedIds.add(agent.id);
            }
        }
    }

    // 4. 보완적 에이전트 - 도메인별 차별화
    const isTechQuestion = topicAnalysis.matchedCategories.some(c => DISCUSSION_DOMAIN_CATEGORIES.TECH.includes(c));
    const isBusinessQuestion = topicAnalysis.matchedCategories.some(c => DISCUSSION_DOMAIN_CATEGORIES.BUSINESS.includes(c));
    const isSocialQuestion = topicAnalysis.matchedCategories.some(c => DISCUSSION_DOMAIN_CATEGORIES.SOCIAL.includes(c));

    const addComplementary = (agentIds: readonly string[]) => {
        for (const agentId of agentIds) {
            if (usedIds.has(agentId)) continue;
            const agent = getAgentById(agentId);
            if (agent) {
                result.push(agent);
                usedIds.add(agentId);
            }
        }
    };

    if (isTechQuestion && !isBusinessQuestion) {
        addComplementary(DISCUSSION_COMPLEMENTARY_AGENTS.TECH);
    } else if (isBusinessQuestion && !isTechQuestion) {
        addComplementary(DISCUSSION_COMPLEMENTARY_AGENTS.BUSINESS);
    } else if (isSocialQuestion) {
        addComplementary(DISCUSSION_COMPLEMENTARY_AGENTS.SOCIAL);
    } else if (result.length < 3) {
        for (const agentId of DISCUSSION_COMPLEMENTARY_AGENTS.DIVERSE) {
            if (usedIds.has(agentId)) continue;
            const agent = getAgentById(agentId);
            if (agent) {
                result.push(agent);
                usedIds.add(agentId);
            }
            if (result.length >= 5) break;
        }
    }

    // 최종적으로 count 제한 적용 (count가 0이면 전체 반환)
    return count === 0 ? result : result.slice(0, count);
}
