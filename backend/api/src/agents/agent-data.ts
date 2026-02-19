/**
 * ============================================================
 * 에이전트 공유 데이터 모듈
 * ============================================================
 *
 * AGENTS 플랫 맵, industryData, getAgentById 등
 * 여러 모듈에서 공유하는 에이전트 데이터를 제공한다.
 * 순환 의존성을 방지하기 위해 별도 모듈로 분리.
 *
 * @module agents/agent-data
 */

import {
    Agent,
    AgentCategory,
    IndustryAgentsData,
    getIndustryAgentsData
} from './types';

// ========================================
// AGENTS 상수 (하위 호환성)
// ========================================

export const industryData: IndustryAgentsData = getIndustryAgentsData();

// 플랫 에이전트 맵 생성 (id -> Agent)
export const AGENTS: Record<string, Agent> = {};

for (const [categoryId, category] of Object.entries(industryData)) {
    for (const agent of category.agents) {
        AGENTS[agent.id] = {
            ...agent,
            emoji: category.icon,
            category: categoryId
        };
    }
}

// 기본 에이전트 추가 (기존 코드 호환성)
AGENTS['general'] = {
    id: 'general',
    name: '범용 AI 어시스턴트',
    description: '다양한 질문에 도움을 드리는 범용 AI',
    keywords: [],
    emoji: '🤖',
    category: 'general'
};

/**
 * 에이전트 ID로 에이전트 찾기
 *
 * AGENTS 플랫 맵에서 해당 ID의 에이전트를 조회한다.
 *
 * @param agentId - 조회할 에이전트 ID (예: 'software-engineer')
 * @returns {Agent | null} - 에이전트 객체, 없으면 null
 */
export function getAgentById(agentId: string): Agent | null {
    return AGENTS[agentId] || null;
}
