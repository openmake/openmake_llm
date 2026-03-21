/**
 * ============================================================
 * 에이전트 라우팅 (통합 라우터)
 * ============================================================
 *
 * 2단계 라우팅 전략으로 최적의 에이전트를 선택한다:
 * 1단계: 의도 기반 토픽 분석 (analyzeTopicIntent)
 * 2단계: 향상된 키워드 매칭 (TF-IDF + 동의어 + 카테고리 가중치)
 *
 * @module agents/keyword-router
 */

import {
    AgentSelection,
    AgentPhase
} from './types';
import { AGENTS, industryData, getAgentById } from './agent-data';
import { analyzeTopicIntent, TOPIC_CATEGORIES } from './topic-analyzer';
import { createLogger } from '../utils/logger';
import { getEnhancedKeywords, getKeywordIDF, getSynonyms, getCategoryWeight } from './enhanced-keywords';
import { CATEGORY_BOOST, EXPANDED_DAMPING } from '../config/routing-config';
import { CONFIDENCE_DIVISORS } from '../config/llm-parameters';

const logger = createLogger('AgentRouter');

// ========================================
// 에이전트 라우팅 (2단계: 토픽 분석 + 키워드 매칭)
// ========================================

/**
 * 메시지를 분석하여 가장 적합한 에이전트 선택 (통합 라우터)
 *
 * 2단계 라우팅 전략으로 최적의 에이전트를 선택한다:
 *
 * 1단계 (토픽 분석): analyzeTopicIntent()로 의도 기반 분류
 *   - 8개 도메인 카테고리의 정규식 패턴 매칭
 *   - 매칭된 카테고리의 모든 에이전트에 CATEGORY_BOOST 부여
 *
 * 2단계 (향상된 키워드 매칭):
 *   - 기존 키워드 + 스킬 기반 확장 키워드 + 동의어 확장
 *   - TF-IDF 가중치: 희귀 키워드는 높은 점수, 공통 키워드는 낮은 점수
 *   - 카테고리별 가중치: technology 1.2, healthcare/legal 1.1 등
 *   - 최고 점수 에이전트 선택 (confidence = min(score/10, 1.0))
 *
 * @param message - 사용자 입력 메시지
 * @returns {Promise<AgentSelection>} - 선택된 에이전트 정보 (ID, 카테고리, 페이즈, 신뢰도)
 */
export async function routeToAgent(message: string): Promise<AgentSelection> {
    const lowerMessage = message.toLowerCase();
    const words = lowerMessage.split(/\s+/);

    // 동의어 확장: 쿼리 단어의 동의어를 미리 수집
    const expandedQueryTerms = new Set<string>(words);
    for (const word of words) {
        const synonyms = getSynonyms(word);
        for (const syn of synonyms) {
            expandedQueryTerms.add(syn.toLowerCase());
        }
    }

    // 디버그: AGENTS 맵 상태 확인
    const agentCount = Object.keys(AGENTS).length;
    const categoryCount = Object.keys(industryData).length;
    logger.info(`메시지: "${message.substring(0, 50)}..." | 등록된 에이전트: ${agentCount}개, 카테고리: ${categoryCount}개`);

    // 1단계: 의도 기반 토픽 분석
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

    // 🆕 의도 분석 결과로 카테고리 부스트 세트 구성
    // 매칭된 모든 카테고리의 에이전트에게 동일 부스트를 부여하여
    // Layer 2 키워드가 카테고리 내 세부 에이전트를 구분하도록 한다
    const categoryBoostAgents = new Set<string>();
    for (const category of TOPIC_CATEGORIES) {
        if (topicAnalysis.matchedCategories.includes(category.name)) {
            for (const agentId of category.relatedAgents) {
                categoryBoostAgents.add(agentId);
            }
        }
    }

    // 2단계: 향상된 키워드 매칭 (TF-IDF + 동의어 + 카테고리 가중치)
    // PRIMARY (에이전트 고유 키워드) = 전체 가중치, EXPANDED (카테고리 어휘) = EXPANDED_DAMPING x 감쇄

    for (const [categoryId, category] of Object.entries(industryData)) {
        const categoryWeight = getCategoryWeight(categoryId);

        for (const agent of category.agents) {
            let score = categoryBoostAgents.has(agent.id) ? CATEGORY_BOOST : 0;
            const matchedKeywords: string[] = [];
            const enhancedKws = getEnhancedKeywords(agent.id);

            // 에이전트 고유 키워드 세트 (대소문자 정규화)
            const primaryKeywordSet = new Set<string>(
                agent.keywords.map(k => k.toLowerCase())
            );

            for (const keyword of enhancedKws) {
                const keywordLower = keyword.toLowerCase();
                const idf = getKeywordIDF(keyword);
                const isPrimary = primaryKeywordSet.has(keywordLower);
                const tierMultiplier = isPrimary ? 1.0 : EXPANDED_DAMPING;
                let matched = false;

                // 2글자 이하 키워드는 단어 완전 일치만 허용 (오매칭 방지)
                if (keywordLower.length <= 2) {
                    if (expandedQueryTerms.has(keywordLower)) {
                        score += 3 * idf * categoryWeight * tierMultiplier;
                        matched = true;
                    }
                } else {
                    // 3글자 이상은 부분 일치 허용
                    if (lowerMessage.includes(keywordLower)) {
                        score += 2 * idf * categoryWeight * tierMultiplier;
                        matched = true;
                    }
                    // 동의어 확장 매칭 (직접 매칭 안 됐을 때)
                    if (!matched && expandedQueryTerms.has(keywordLower)) {
                        score += 1.5 * idf * categoryWeight * tierMultiplier;
                        matched = true;
                    }
                    // 단어 완전 일치 보너스
                    if (matched && words.includes(keywordLower)) {
                        score += 1 * idf * categoryWeight * tierMultiplier;
                    }
                }

                if (matched) {
                    matchedKeywords.push(keyword);
                }
            }

            if (score > highestScore) {
                highestScore = score;
                bestMatch = {
                    primaryAgent: agent.id,
                    category: categoryId,
                    phase: detectPhase(message),
                    reason: `${agent.name} - ${matchedKeywords.slice(0, 5).join(', ')} 키워드 매칭`,
                    confidence: Math.min(score / CONFIDENCE_DIVISORS.KEYWORD_ROUTER, 1.0),
                    matchedKeywords
                };
            }
        }
    }

    // 디버그: 최종 선택 결과
    logger.info(`선택: ${bestMatch.primaryAgent} (점수: ${highestScore.toFixed(2)}, 신뢰도: ${bestMatch.confidence})`);
    if (bestMatch.matchedKeywords && bestMatch.matchedKeywords.length > 0) {
        logger.info(`매칭 키워드: ${bestMatch.matchedKeywords.slice(0, 10).join(', ')}`);
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
