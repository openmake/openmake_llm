/**
 * ============================================================
 * Complexity Assessor - 쿼리 복잡도 평가
 * ============================================================
 *
 * A2A 게이팅을 위한 쿼리 복잡도 점수를 계산합니다.
 * Pro/Think 프로파일에서 단순 쿼리의 불필요한 A2A 호출을 방지합니다.
 *
 * @module chat/complexity-assessor
 */

import type { QueryClassification } from './model-selector-types';
import { createLogger } from '../utils/logger';

const logger = createLogger('ComplexityAssessor');

/** A2A 건너뛰기 임계값 - 이 점수 미만이면 A2A 생략 */
export const A2A_SKIP_THRESHOLD = 0.3;

/** 복잡도 평가 입력 컨텍스트 */
export interface ComplexityContext {
    query: string;
    classification: QueryClassification;
    hasImages: boolean;
    hasDocuments: boolean;
    historyLength: number;
}

/** 복잡도 평가 결과 */
export interface ComplexityAssessment {
    /** 복잡도 점수 (0.0~1.0) */
    score: number;
    /** 적용된 시그널 목록 (디버그용) */
    signals: string[];
    /** A2A 건너뛰기 여부 */
    shouldSkipA2A: boolean;
}

/**
 * 쿼리 복잡도를 평가하여 A2A 게이팅 결정을 내립니다.
 */
export function assessComplexity(ctx: ComplexityContext): ComplexityAssessment {
    let score = 0.5; // 중립 시작점
    const signals: string[] = [];

    // ── 단순성 시그널 (감점) ──
    if (ctx.query.length < 30) {
        score -= 0.3;
        signals.push('very_short_query');
    } else if (ctx.query.length < 50) {
        score -= 0.1;
        signals.push('short_query');
    }

    if (ctx.classification.type === 'chat') {
        score -= 0.2;
        signals.push('chat_type');
    }

    if (ctx.classification.confidence < 0.2) {
        score -= 0.1;
        signals.push('low_confidence');
    }

    // ── 복잡성 시그널 (가점) ──
    if (ctx.query.length > 200) {
        score += 0.2;
        signals.push('long_query');
    }

    if (ctx.classification.matchedPatterns.length >= 3) {
        score += 0.2;
        signals.push('multiple_patterns');
    }

    if (/```/.test(ctx.query)) {
        score += 0.3;
        signals.push('has_code_block');
    }

    if (ctx.hasImages) {
        score += 0.2;
        signals.push('has_images');
    }

    if (ctx.hasDocuments) {
        score += 0.2;
        signals.push('has_documents');
    }

    if (ctx.historyLength > 5) {
        score += 0.1;
        signals.push('long_history');
    }

    if (['analysis', 'math', 'document'].includes(ctx.classification.type)) {
        score += 0.1;
        signals.push(`complex_type:${ctx.classification.type}`);
    }

    // 0~1 범위로 클램프
    score = Math.max(0, Math.min(1, score));
    const shouldSkipA2A = score < A2A_SKIP_THRESHOLD;

    if (shouldSkipA2A) {
        logger.info(`복잡도 낮음 → A2A 건너뜀: score=${score.toFixed(2)}, signals=[${signals.join(', ')}]`);
    } else {
        logger.debug(`복잡도 충분 → A2A 실행: score=${score.toFixed(2)}, signals=[${signals.join(', ')}]`);
    }

    return { score, signals, shouldSkipA2A };
}
