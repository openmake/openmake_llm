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
import {
    A2A_SKIP_THRESHOLD as _A2A_SKIP_THRESHOLD,
    COMPLEXITY_NEUTRAL_SCORE,
    COMPLEXITY_WEIGHTS,
} from '../config/routing-config';

const logger = createLogger('ComplexityAssessor');

/** A2A 건너뛰기 임계값 - 이 점수 미만이면 A2A 생략 (routing-config에서 re-export) */
export const A2A_SKIP_THRESHOLD = _A2A_SKIP_THRESHOLD;

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
    let score = COMPLEXITY_NEUTRAL_SCORE; // 중립 시작점
    const signals: string[] = [];

    // ── 단순성 시그널 (감점) ──
    if (ctx.query.length < COMPLEXITY_WEIGHTS.VERY_SHORT_THRESHOLD) {
        score += COMPLEXITY_WEIGHTS.VERY_SHORT_PENALTY;
        signals.push('very_short_query');
    } else if (ctx.query.length < COMPLEXITY_WEIGHTS.SHORT_THRESHOLD) {
        score += COMPLEXITY_WEIGHTS.SHORT_PENALTY;
        signals.push('short_query');
    }

    if (ctx.classification.type === 'chat') {
        score += COMPLEXITY_WEIGHTS.CHAT_TYPE_PENALTY;
        signals.push('chat_type');
    }

    if (ctx.classification.confidence < COMPLEXITY_WEIGHTS.LOW_CONFIDENCE_THRESHOLD) {
        score += COMPLEXITY_WEIGHTS.LOW_CONFIDENCE_PENALTY;
        signals.push('low_confidence');
    }

    // ── 복잡성 시그널 (가점) ──
    if (ctx.query.length > COMPLEXITY_WEIGHTS.LONG_THRESHOLD) {
        score += COMPLEXITY_WEIGHTS.LONG_QUERY_BONUS;
        signals.push('long_query');
    }

    if (ctx.classification.matchedPatterns.length >= COMPLEXITY_WEIGHTS.MIN_PATTERN_COUNT) {
        score += COMPLEXITY_WEIGHTS.MULTIPLE_PATTERNS_BONUS;
        signals.push('multiple_patterns');
    }

    if (/```/.test(ctx.query)) {
        score += COMPLEXITY_WEIGHTS.CODE_BLOCK_BONUS;
        signals.push('has_code_block');
    }

    if (ctx.hasImages) {
        score += COMPLEXITY_WEIGHTS.HAS_IMAGES_BONUS;
        signals.push('has_images');
    }

    if (ctx.hasDocuments) {
        score += COMPLEXITY_WEIGHTS.HAS_DOCUMENTS_BONUS;
        signals.push('has_documents');
    }

    if (ctx.historyLength > COMPLEXITY_WEIGHTS.MIN_HISTORY_LENGTH) {
        score += COMPLEXITY_WEIGHTS.LONG_HISTORY_BONUS;
        signals.push('long_history');
    }

    if (['analysis', 'math', 'math-hard', 'math-applied', 'reasoning', 'document', 'code-agent'].includes(ctx.classification.type)) {
        score += COMPLEXITY_WEIGHTS.COMPLEX_TYPE_BONUS;
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
