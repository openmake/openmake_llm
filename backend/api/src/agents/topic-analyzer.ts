/**
 * ============================================================
 * 의도 기반 토픽 분류 시스템
 * ============================================================
 *
 * 일상 언어의 질문을 전문 에이전트로 매핑하기 위한
 * 토픽 카테고리 정의 및 의도 분석 기능을 제공한다.
 *
 * @module agents/topic-analyzer
 */

import topicCategoriesData from '../config/data/topic-categories.json';
import { CONFIDENCE_DIVISORS } from '../config/llm-parameters';

// ========================================
// 의도 기반 토픽 분류 시스템
// ========================================

/**
 * 토픽 카테고리 정의 인터페이스
 *
 * 일상 언어의 질문을 전문 에이전트로 매핑하기 위한 카테고리 구조.
 * 정규식 패턴으로 질문을 분류하고, 관련 에이전트 ID 목록을 제공한다.
 *
 * @interface TopicCategory
 */
export interface TopicCategory {
    /** 카테고리 표시 이름 (예: '프로그래밍/개발', '금융/투자') */
    name: string;
    /** 질문 매칭용 정규식 패턴 배열 (하나라도 매칭되면 해당 카테고리) */
    patterns: RegExp[];
    /** 이 카테고리에 속하는 에이전트 ID 목록 */
    relatedAgents: string[];
    /** 카테고리 확장 검색용 키워드 */
    expansionKeywords: string[];
    /** 제외 패턴: 이 패턴이 매칭되면 해당 카테고리 점수를 차감 (오분류 방지) */
    excludePatterns?: RegExp[];
}

interface RawPatternEntry {
    source: string;
    flags: string;
}

interface RawTopicCategory {
    name: string;
    patterns: RawPatternEntry[];
    excludePatterns: RawPatternEntry[];
    relatedAgents: string[];
    expansionKeywords: string[];
}

function compileTopicCategories(raw: RawTopicCategory[]): TopicCategory[] {
    return raw.map((item) => ({
        name: item.name,
        patterns: item.patterns.map((p) => new RegExp(p.source, p.flags)),
        excludePatterns: item.excludePatterns.length > 0
            ? item.excludePatterns.map((p) => new RegExp(p.source, p.flags))
            : undefined,
        relatedAgents: item.relatedAgents,
        expansionKeywords: item.expansionKeywords,
    }));
}

/**
 * 일상 언어 -> 전문 에이전트 매핑 테이블
 *
 * 8개 도메인 카테고리별로 정규식 패턴과 관련 에이전트를 정의한다.
 * 각 카테고리는 여러 정규식 패턴을 가지며, 매칭된 패턴 수가
 * 많을수록 해당 카테고리의 관련성이 높다고 판단한다.
 *
 * 카테고리 목록 (17개):
 * - 프로그래밍/개발: 앱, 코딩, API, 서버, 프레임워크 관련
 * - 비즈니스/창업: 사업, 마케팅, 전략, 경영 관련
 * - 금융/투자: 주식, 세금, 자산관리 관련
 * - 법률/계약: 소송, 계약서, 저작권, 규제 관련
 * - 의료/건강: 진료, 증상, 다이어트, 정신건강 관련
 * - 교육/학습: 공부, 시험, 자격증, 면접 관련
 * - 디자인/크리에이티브: UI/UX, 영상, 글쓰기, 게임 관련
 * - 데이터/AI: 데이터분석, 머신러닝, NLP, 예측 관련
 * - 엔지니어링: 기계, 전기, 토목, 화학, 로봇 관련
 * - 과학/연구: 논문, 실험, 물리, 화학, 생물 관련
 * - 미디어/커뮤니케이션: 언론, PR, SNS, 스토리텔링 관련
 * - 공공/정부: 정책, 행정, 도시계획, 외교 관련
 * - 부동산: 매매, 건축, 임대, 개발 관련
 * - 에너지/환경: 전력, ESG, 신재생에너지 관련
 * - 물류/운송: 배송, 창고, SCM, 유통 관련
 * - 관광/호스피탈리티: 호텔, 여행, 이벤트, MICE 관련
 * - 농업/식품: 재배, 식품가공, 스마트팜 관련
 *
 * 패턴 데이터 원천: backend/api/src/config/data/topic-categories.json
 */
export const TOPIC_CATEGORIES: TopicCategory[] = compileTopicCategories(
    topicCategoriesData.topicCategories as RawTopicCategory[]
);

/**
 * 의도 기반 토픽 분석 (점수 기반 우선순위)
 *
 * 사용자 메시지를 TOPIC_CATEGORIES의 정규식 패턴과 대조하여
 * 매칭되는 카테고리와 관련 에이전트를 추출한다.
 *
 * 점수 계산 알고리즘:
 * - 각 카테고리의 패턴 중 매칭된 수를 점수로 사용
 * - 점수가 높은 카테고리 순으로 정렬
 * - 최고 점수 카테고리의 에이전트만 suggestedAgents에 포함
 * - confidence = min(총 매칭 수 / 3, 1.0)
 *
 * @param message - 분석할 사용자 메시지
 * @returns 매칭된 카테고리명, 추천 에이전트 ID, 신뢰도를 포함한 분석 결과
 */
export function analyzeTopicIntent(message: string): {
    matchedCategories: string[];
    suggestedAgents: string[];
    confidence: number;
} {
    // 카테고리별 점수 계산
    const categoryScores: { category: TopicCategory; score: number; matchCount: number }[] = [];

    for (const category of TOPIC_CATEGORIES) {
        let matchCount = 0;
        for (const pattern of category.patterns) {
            if (pattern.test(message)) {
                matchCount++;
            }
        }

        if (matchCount > 0) {
            // C4 수정: 제외 패턴이 매칭되면 점수 차감
            let excludePenalty = 0;
            if (category.excludePatterns) {
                for (const excludePattern of category.excludePatterns) {
                    if (excludePattern.test(message)) {
                        excludePenalty++;
                    }
                }
            }

            // 제외 패널티를 적용한 최종 점수 (최소 0)
            const adjustedScore = Math.max(0, matchCount - excludePenalty);
            if (adjustedScore > 0) {
                categoryScores.push({ category, score: adjustedScore, matchCount: adjustedScore });
            }
        }
    }

    // 점수순 정렬 (내림차순)
    categoryScores.sort((a, b) => b.score - a.score);

    const matchedCategories: string[] = [];
    const suggestedAgentsSet = new Set<string>();
    let totalMatches = 0;

    for (const { category, matchCount } of categoryScores) {
        matchedCategories.push(category.name);
        totalMatches += matchCount;

        // 가장 높은 점수의 카테고리 에이전트만 먼저 추가
        if (suggestedAgentsSet.size === 0) {
            for (const agentId of category.relatedAgents) {
                suggestedAgentsSet.add(agentId);
            }
        }
    }

    return {
        matchedCategories,
        suggestedAgents: Array.from(suggestedAgentsSet),
        confidence: Math.min(totalMatches / CONFIDENCE_DIVISORS.TOPIC_ANALYZER, 1.0)
    };
}
