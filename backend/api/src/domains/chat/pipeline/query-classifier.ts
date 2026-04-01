/**
 * ============================================================
 * Query Classifier - 질문 유형 분류 (정규식 + 키워드 스코어링)
 * ============================================================
 * 
 * 사용자 질문을 분석하여 9가지 QueryType으로 분류합니다.
 * 정규식 패턴 매칭과 키워드 가중치 스코어링 알고리즘을 사용합니다.
 * 
 * @module chat/query-classifier
 * @see chat/model-selector - classifyQuery()를 사용하는 메인 모듈
 * @see chat/model-selector-types - QueryType, QueryClassification 타입 정의
 */

import type { QueryType, QueryClassification } from './model-selector-types';
import queryPatternsData from '../config/data/query-patterns.json';
import { CONFIDENCE_DIVISORS } from '../config/llm-parameters';

// ============================================================
// 질문 유형 분류 패턴
// ============================================================

/**
 * 질문 유형 분류 패턴 인터페이스
 * 정규식과 키워드를 조합하여 질문 유형을 판별합니다.
 */
interface QueryPattern {
    /** 분류 대상 질문 유형 */
    type: QueryType;
    /** 매칭할 정규식 패턴 배열 (매칭 시 weight * 2 점수) */
    patterns: RegExp[];
    /** 매칭할 키워드 배열 (매칭 시 weight * 1 점수) */
    keywords: string[];
    /** 가중치 (유형별 중요도 조정, 기본 1.0) */
    weight: number;
}

interface RawPatternEntry {
    source: string;
    flags: string;
}

interface RawQueryPattern {
    type: string;
    patterns: RawPatternEntry[];
    keywords: string[];
    weight: number;
}

function compileQueryPatterns(raw: RawQueryPattern[]): QueryPattern[] {
    return raw.map((item) => ({
        type: item.type as QueryType,
        patterns: item.patterns.map((p) => new RegExp(p.source, p.flags)),
        keywords: item.keywords,
        weight: item.weight,
    }));
}

const QUERY_PATTERNS: QueryPattern[] = compileQueryPatterns(
    queryPatternsData.queryPatterns as RawQueryPattern[]
);

// ============================================================
// 질문 분류 함수
// ============================================================

/**
 * 사용자 쿼리를 분석하여 질문 유형을 분류합니다.
 * 
 * 분류 알고리즘:
 * 1. 모든 QueryPattern에 대해 정규식 매칭 (weight * 2 점수) + 키워드 매칭 (weight * 1 점수)
 * 2. 가장 높은 점수의 유형을 선택 (동점 시 먼저 발견된 유형)
 * 3. [IMAGE] 메타데이터가 있으면 vision으로 강제 전환
 * 4. 한국어 비율 30% 이상이면 subType='korean' 추가
 * 5. 신뢰도 = min(bestScore / CONFIDENCE_DIVISORS.QUERY_CLASSIFIER, 1.0)
 * 
 * @param query - 분류할 사용자 질문 텍스트
 * @returns 분류 결과 (유형, 신뢰도, 매칭된 패턴)
 */
export function classifyQuery(query: string): QueryClassification {
    const scores: Map<QueryType, { score: number; patterns: string[] }> = new Map();

    // 모든 유형에 대해 점수 계산
    for (const pattern of QUERY_PATTERNS) {
        let score = 0;
        const matchedPatterns: string[] = [];

        // 정규식 패턴 매칭
        for (const regex of pattern.patterns) {
            if (regex.test(query)) {
                score += pattern.weight * 2;
                matchedPatterns.push(regex.source.substring(0, 30));
            }
        }

        // 키워드 매칭
        const lowerQuery = query.toLowerCase();
        for (const keyword of pattern.keywords) {
            if (lowerQuery.includes(keyword.toLowerCase())) {
                score += pattern.weight;
                matchedPatterns.push(keyword);
            }
        }

        if (score > 0) {
            const existing = scores.get(pattern.type);
            if (!existing || existing.score < score) {
                scores.set(pattern.type, { score, patterns: matchedPatterns });
            }
        }
    }

    // 가장 높은 점수의 유형 선택
    let bestType: QueryType = 'chat';
    let bestScore = 0;
    let bestPatterns: string[] = [];

    for (const [type, data] of scores) {
        if (data.score > bestScore) {
            bestType = type;
            bestScore = data.score;
            bestPatterns = data.patterns;
        }
    }

    // 한국어 비율 체크 (30% 이상이면 korean 힌트 추가)
    const koreanPattern = /[\uAC00-\uD7A3]/g;
    const koreanChars = query.match(koreanPattern) || [];
    const koreanRatio = koreanChars.length / query.length;

    // 이미지 관련 메타데이터가 있으면 vision으로 강제
    if (query.includes('[IMAGE]') || query.includes('[image_attached]')) {
        bestType = 'vision';
        bestScore = 10;
        bestPatterns = ['image_metadata'];
    }

    // 2차 세분화: code → code-agent / code-gen
    if (bestType === 'code') {
        const codeAgentPatterns = [
            /(리팩토링|\brefactor\b|아키텍처|\barchitecture\b|\bmigration\b|마이그레이션)/i,
            /(디버그|\bdebug\b|버그.*찾|\bfind.*bug\b|트러블슈팅|\btroubleshoot\b)/i,
            /(코드.*리뷰|\bcode.*review\b|개선|\bimprove\b|최적화.*코드|\boptimize.*code\b)/i,
            /(설계|\bdesign.*pattern\b|\bSOLID\b|\bDRY\b|\bKISS\b)/i,
        ];
        const isCodeAgent = codeAgentPatterns.some(p => p.test(query));
        bestType = isCodeAgent ? 'code-agent' : 'code-gen';
    }

    // 2차 세분화: math → math-hard / math-applied
    if (bestType === 'math') {
        const mathHardPatterns = [
            /(증명|\bproof\b|\btheorem\b|정리|보조정리|\blemma\b)/i,
            /(올림피아드|\bolympiad\b|\bIMO\b|\bAIME\b|\bAMC\b|\bKMO\b)/i,
            /(정수론|\bnumber\s*theory\b|조합론|\bcombinatorics\b)/i,
            /(위상|\btopology\b|추상대수|\babstract\s*algebra\b|해석학)/i,
        ];
        const isMathHard = mathHardPatterns.some(p => p.test(query));
        bestType = isMathHard ? 'math-hard' : 'math-applied';
    }

    // 2차 세분화: analysis → reasoning (논리 추론 감지 시)
    // 한국어 문자는 \w에 해당하지 않아 \b가 동작하지 않으므로 영어에만 \b 적용
    if (bestType === 'analysis') {
        const reasoningPatterns = [
            /(논리적|\blogical\b|논리|\blogic\b)/i,
            /(인과|\bcausal\b|원인.*결과|cause.*effect)/i,
            /(만약.*라면|if.*then|가설|\bhypothesis\b)/i,
            /(비판|\bcritique\b|반박|counter.*argument|논증|\bargument\b)/i,
            /(추론|\binference\b|연역|\bdeduction\b|귀납|\binduction\b)/i,
        ];
        const isReasoning = reasoningPatterns.some(p => p.test(query));
        if (isReasoning) bestType = 'reasoning';
    }

    // 신뢰도 계산 (0~1)
    const confidence = Math.min(bestScore / CONFIDENCE_DIVISORS.QUERY_CLASSIFIER, 1.0);

    return {
        type: bestType,
        confidence,
        subType: koreanRatio > 0.3 ? 'korean' : undefined,
        matchedPatterns: bestPatterns.slice(0, 5),
    };
}
