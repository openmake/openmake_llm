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
    const fullText = context ? `${message}\n\n컨텍스트: ${context}` : message;
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

    // 🆕 4. 보완적 에이전트 - 기술적 질문에는 기술 에이전트만, 비즈니스 질문에는 비즈니스 에이전트만
    const techCategories = ['프로그래밍/개발', '데이터/AI'];
    const businessCategories = ['비즈니스/창업', '금융/투자'];

    const isTechQuestion = topicAnalysis.matchedCategories.some(c => techCategories.includes(c));
    const isBusinessQuestion = topicAnalysis.matchedCategories.some(c => businessCategories.includes(c));

    // 🆕 기술적 질문이면 기술 보완 에이전트만
    if (isTechQuestion && !isBusinessQuestion) {
        const techComplementary = ['software-engineer', 'devops-engineer', 'ai-ml-engineer', 'data-analyst'];
        for (const agentId of techComplementary) {
            if (usedIds.has(agentId)) continue;
            const agent = getAgentById(agentId);
            if (agent) {
                result.push(agent);
                usedIds.add(agentId);
            }
        }
    }
    // 🆕 비즈니스 질문이면 비즈니스 보완 에이전트만
    else if (isBusinessQuestion && !isTechQuestion) {
        const businessComplementary = ['business-strategist', 'financial-analyst', 'risk-manager', 'project-manager'];
        for (const agentId of businessComplementary) {
            if (usedIds.has(agentId)) continue;
            const agent = getAgentById(agentId);
            if (agent) {
                result.push(agent);
                usedIds.add(agentId);
            }
        }
    }
    // 🆕 혼합 질문 또는 카테고리 미분류 시에만 다양한 관점 추가
    else if (result.length < 3) {
        const diverseAgents = ['business-strategist', 'data-analyst', 'project-manager'];
        for (const agentId of diverseAgents) {
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
