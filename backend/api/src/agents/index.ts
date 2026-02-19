/**
 * ============================================================
 * 에이전트 시스템 - 메인 엔트리포인트 및 통합 라우터
 * ============================================================
 *
 * 96개 산업별 전문가 에이전트의 라우팅, 시스템 프롬프트 생성,
 * 토론용 에이전트 추천을 담당하는 에이전트 시스템의 핵심 모듈.
 * LLM 의미론적 라우팅과 키워드 기반 폴백의 2단계 라우팅을 제공한다.
 *
 * @module agents/index
 * @description
 * - 2단계 에이전트 라우팅: LLM 의미론적 분석 (우선) + 키워드 매칭 (폴백)
 * - 의도 기반 토픽 분류 시스템 (8개 카테고리: 개발, 비즈니스, 금융, 법률, 의료, 교육, 디자인, 데이터/AI)
 * - 에이전트 선택 결과 기반 시스템 프롬프트 생성 (카테고리별 프롬프트 파일 로드)
 * - 토론용 관련 에이전트 추천 (기술/비즈니스 도메인별 보완 에이전트 선택)
 * - 작업 페이즈 감지 (planning / build / optimization)
 * - 하위 호환성을 위한 AGENTS 플랫 맵 및 유틸리티 함수
 *
 * @see {@link module:agents/llm-router} - LLM 기반 의미론적 라우팅
 * @see {@link module:agents/monitor} - 에이전트 성능 모니터링
 * @see {@link module:agents/discussion-engine} - 다중 에이전트 토론 엔진
 * @see {@link module:chat/pipeline-profile} - 브랜드 모델 프로파일
 */

import {
    Agent,
    AgentCategory
} from './types';

// Re-export types and monitor
export * from './types';
export { getAgentMonitor, AgentMonitor } from './monitor';

// Re-export from agent-data (shared data module)
export { AGENTS, getAgentById } from './agent-data';
import { AGENTS, industryData } from './agent-data';

// Re-export from topic-analyzer
export { analyzeTopicIntent } from './topic-analyzer';
export type { TopicCategory } from './topic-analyzer';
export { TOPIC_CATEGORIES } from './topic-analyzer';

// Re-export from keyword-router
export { routeToAgent, detectPhase } from './keyword-router';

// Re-export from discussion-recommender
export { getRelatedAgentsForDiscussion } from './discussion-recommender';

// Re-export from system-prompt
export { getAgentSystemMessage, getPhaseLabel, getDefaultSystemPrompt } from './system-prompt';

// ========================================
// 유틸리티 함수
// ========================================

/**
 * 전체 에이전트 목록 반환
 *
 * AGENTS 플랫 맵의 모든 에이전트를 배열로 반환한다.
 * 'general' 기본 에이전트를 포함한다.
 *
 * @returns {Agent[]} - 전체 에이전트 배열
 */
export function getAllAgents(): Agent[] {
    return Object.values(AGENTS);
}

/**
 * 카테고리별 에이전트 목록 반환
 *
 * industry-agents.json의 원본 카테고리 구조를 그대로 반환한다.
 *
 * @returns {Record<string, AgentCategory>} - 카테고리 ID를 키로 하는 카테고리 맵
 */
export function getAgentCategories(): Record<string, AgentCategory> {
    return industryData;
}

/**
 * 카테고리별 에이전트 수 통계
 *
 * industry-agents.json의 카테고리별 에이전트 수와 전체 합계를 반환한다.
 *
 * @returns 총 에이전트 수와 카테고리별 에이전트 수를 포함한 통계 객체
 */
export function getAgentStats(): { total: number; byCategory: Record<string, number> } {
    const byCategory: Record<string, number> = {};
    let total = 0;

    for (const [categoryId, category] of Object.entries(industryData)) {
        byCategory[categoryId] = category.agents.length;
        total += category.agents.length;
    }

    return { total, byCategory };
}
