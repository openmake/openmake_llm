/**
 * ============================================================
 * 에이전트 라우팅 (통합 라우터)
 * ============================================================
 *
 * 2단계 라우팅 전략으로 최적의 에이전트를 선택한다:
 * 1단계: LLM 의미론적 분석 (우선)
 * 2단계: 키워드 기반 매칭 (폴백)
 *
 * @module agents/keyword-router
 */

import {
    AgentSelection,
    AgentPhase
} from './types';
import { AGENTS, industryData, getAgentById } from './agent-data';
import { analyzeTopicIntent } from './topic-analyzer';
import { routeWithLLM, isValidAgentId } from './llm-router';
import { createLogger } from '../utils/logger';

const logger = createLogger('AgentRouter');

// ========================================
// 에이전트 라우팅 (개선됨)
// ========================================

/**
 * 메시지를 분석하여 가장 적합한 에이전트 선택 (통합 라우터)
 *
 * 2단계 라우팅 전략으로 최적의 에이전트를 선택한다:
 *
 * 1단계 (LLM 라우팅): routeWithLLM()으로 의미론적 분석 시도
 *   - 신뢰도 0.3 초과 + 유효한 에이전트 ID이면 즉시 반환
 *   - 타임아웃 10초, 실패 시 2단계로 폴백
 *
 * 2단계 (키워드 라우팅):
 *   a. 의도 기반 토픽 분석 (analyzeTopicIntent) - 기본 점수 5
 *   b. 키워드 정밀 매칭 (industry-agents.json 전체 순회)
 *      - 2글자 이하: 단어 완전 일치만 허용 (오매칭 방지), 점수 +3
 *      - 3글자 이상: 부분 일치 +2, 완전 일치 보너스 +1
 *      - 에이전트 이름 포함 +3, ID 포함 +2
 *   c. 최고 점수 에이전트 선택 (confidence = min(score/10, 1.0))
 *
 * @param message - 사용자 입력 메시지
 * @param useLLM - LLM 라우팅 사용 여부 (기본값: true)
 * @returns {Promise<AgentSelection>} - 선택된 에이전트 정보 (ID, 카테고리, 페이즈, 신뢰도)
 */
export async function routeToAgent(message: string, useLLM: boolean = true): Promise<AgentSelection> {
    const lowerMessage = message.toLowerCase();
    const words = lowerMessage.split(/\s+/);

    // 디버그: AGENTS 맵 상태 확인
    const agentCount = Object.keys(AGENTS).length;
    const categoryCount = Object.keys(industryData).length;
    logger.info(`메시지: "${message.substring(0, 50)}..." | 등록된 에이전트: ${agentCount}개, 카테고리: ${categoryCount}개`);

    // 🆕 LLM 기반 라우팅 시도 (우선순위 1) - 개선됨: 신뢰도 조건 완화
    if (useLLM) {
        try {
            const llmResult = await routeWithLLM(message, 10000); // 타임아웃 10초로 증가
            if (llmResult && llmResult.confidence > 0.3 && isValidAgentId(llmResult.agentId)) {
                const agent = getAgentById(llmResult.agentId);
                if (agent) {
                    logger.info(`✅ LLM 라우팅 성공: ${agent.name} (신뢰도: ${llmResult.confidence})`);
                    return {
                        primaryAgent: agent.id,
                        category: agent.category || 'general',
                        phase: detectPhase(message),
                        reason: `${agent.name} - LLM 분석: ${llmResult.reasoning}`,
                        confidence: llmResult.confidence,
                        matchedKeywords: []
                    };
                }
            }
        } catch (error) {
            logger.info('LLM 라우팅 실패, 키워드 폴백 사용');
        }
    }

    // 🆕 1단계: 의도 기반 토픽 분석
    const topicAnalysis = analyzeTopicIntent(message);
    logger.info(`토픽 분석: ${topicAnalysis.matchedCategories.join(', ') || '없음'} (신뢰도: ${topicAnalysis.confidence})`);

    let bestMatch: AgentSelection = {
        primaryAgent: 'general',
        category: 'general',
        phase: 'planning',
        reason: '기본 범용 에이전트',
        confidence: 0.3,
        matchedKeywords: []
    };

    let highestScore = 0;

    // 🆕 의도 분석 결과로 우선 검색
    if (topicAnalysis.suggestedAgents.length > 0) {
        const intentAgent = getAgentById(topicAnalysis.suggestedAgents[0]);
        if (intentAgent) {
            highestScore = 5; // 의도 매칭 기본 점수
            bestMatch = {
                primaryAgent: intentAgent.id,
                category: intentAgent.category || 'general',
                phase: detectPhase(message),
                reason: `${intentAgent.name} - ${topicAnalysis.matchedCategories[0]} 토픽 매칭`,
                confidence: Math.max(0.5, topicAnalysis.confidence),
                matchedKeywords: topicAnalysis.matchedCategories
            };
        }
    }

    // 2단계: 키워드 기반 정밀 매칭 (더 높은 점수 시 덮어씀)
    for (const [categoryId, category] of Object.entries(industryData)) {
        for (const agent of category.agents) {
            let score = 0;
            const matchedKeywords: string[] = [];

            // 키워드 매칭 (🆕 최소 길이 체크로 오매칭 방지)
            for (const keyword of agent.keywords) {
                const keywordLower = keyword.toLowerCase();

                // 2글자 이하 키워드는 단어 완전 일치만 허용 (오매칭 방지)
                if (keywordLower.length <= 2) {
                    if (words.includes(keywordLower)) {
                        score += 3;
                        matchedKeywords.push(keyword);
                    }
                } else {
                    // 3글자 이상은 부분 일치 허용
                    if (lowerMessage.includes(keywordLower)) {
                        score += 2;
                        matchedKeywords.push(keyword);
                    }
                    // 단어 완전 일치 보너스
                    if (words.includes(keywordLower)) {
                        score += 1;
                    }
                }
            }

            // 에이전트 이름 포함 시 보너스
            if (lowerMessage.includes(agent.name.toLowerCase())) {
                score += 3;
                matchedKeywords.push(agent.name);
            }

            // 에이전트 ID 포함 시 보너스
            if (lowerMessage.includes(agent.id.replace(/-/g, ' '))) {
                score += 2;
            }

            if (score > highestScore) {
                highestScore = score;
                bestMatch = {
                    primaryAgent: agent.id,
                    category: categoryId,
                    phase: detectPhase(message),
                    reason: `${agent.name} - ${matchedKeywords.slice(0, 3).join(', ')} 키워드 매칭`,
                    confidence: Math.min(score / 10, 1.0),
                    matchedKeywords
                };
            }
        }
    }

    // 디버그: 최종 선택 결과
    logger.info(`선택: ${bestMatch.primaryAgent} (점수: ${highestScore}, 신뢰도: ${bestMatch.confidence})`);
    if (bestMatch.matchedKeywords && bestMatch.matchedKeywords.length > 0) {
        logger.info(`매칭 키워드: ${bestMatch.matchedKeywords.join(', ')}`);
    }

    return bestMatch;
}

/**
 * 메시지에서 작업 페이즈(단계) 감지
 *
 * 사용자 메시지의 키워드를 분석하여 현재 작업 단계를 판별한다.
 * 키워드 우선순위: planning > build > optimization (먼저 매칭된 것 반환)
 *
 * - planning: 설계, 계획, 분석, 조사, 어떻게, 방법 등
 * - build: 구현, 개발, 코딩, 만들어, 해줘 등
 * - optimization: 최적화, 개선, 리팩토링, 성능 등
 *
 * @param message - 사용자 메시지
 * @returns {AgentPhase} - 감지된 작업 페이즈 (기본값: 'planning')
 */
export function detectPhase(message: string): AgentPhase {
    const lowerMessage = message.toLowerCase();

    // 기획/설계 관련 키워드
    const planningKeywords = ['설계', '계획', '기획', '분석', '조사', '검토', '평가', '전략', 'plan', 'design', 'analyze', '어떻게', '방법', '뭐가', '무엇'];
    if (planningKeywords.some(kw => lowerMessage.includes(kw))) {
        return 'planning';
    }

    // 구현/개발 관련 키워드
    const buildKeywords = ['구현', '개발', '코딩', '만들', '작성', '생성', 'implement', 'build', 'create', 'develop', '해줘', '해 줘'];
    if (buildKeywords.some(kw => lowerMessage.includes(kw))) {
        return 'build';
    }

    // 최적화/개선 관련 키워드
    const optimizationKeywords = ['최적화', '개선', '리팩토링', '성능', '효율', 'optimize', 'improve', 'refactor', '더 좋', '더좋'];
    if (optimizationKeywords.some(kw => lowerMessage.includes(kw))) {
        return 'optimization';
    }

    return 'planning';
}
