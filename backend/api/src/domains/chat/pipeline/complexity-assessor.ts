/**
 * ============================================================
 * Complexity Assessor - 쿼리 복잡도 평가
 * ============================================================
 *
 * GV(Generate-Verify) 게이팅을 위한 쿼리 복잡도 점수를 계산합니다.
 * conditional-verify 프로파일에서 단순 쿼리의 불필요한 GV 호출을 방지합니다.
 *
 * @module chat/complexity-assessor
 */

<<<<<<< HEAD:backend/api/src/domains/chat/pipeline/complexity-assessor.ts
import type { QueryClassification } from './model-selector-types';
import { createLogger } from '../../../utils/logger';
=======
import type { QueryClassification, QueryType } from './model-selector-types';
import { createLogger } from '../utils/logger';
import {
    GV_SKIP_THRESHOLD as _GV_SKIP_THRESHOLD,
    COMPLEXITY_NEUTRAL_SCORE,
    COMPLEXITY_WEIGHTS,
} from '../config/routing-config';
import { TOKEN_BUDGETS } from '../config/llm-parameters';
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78:backend/api/src/chat/complexity-assessor.ts

const logger = createLogger('ComplexityAssessor');

/** GV 건너뛰기 임계값 - 이 점수 미만이면 Generate-Verify 생략 (routing-config에서 re-export) */
export const GV_SKIP_THRESHOLD = _GV_SKIP_THRESHOLD;

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
    /** GV(Generate-Verify) 건너뛰기 여부 */
    shouldSkipGV: boolean;
    /** 권장 토큰 예산 (0=제한 없음) */
    recommendedTokenBudget: number;
}

/**
 * 쿼리 복잡도를 평가하여 GV(Generate-Verify) 게이팅 결정을 내립니다.
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
    const shouldSkipGV = score < GV_SKIP_THRESHOLD;

    if (shouldSkipGV) {
        logger.info(`복잡도 낮음 → GV 건너뜀: score=${score.toFixed(2)}, signals=[${signals.join(', ')}]`);
    } else {
        logger.debug(`복잡도 충분 → GV 실행: score=${score.toFixed(2)}, signals=[${signals.join(', ')}]`);
    }

    const recommendedTokenBudget = recommendTokenBudget(score, ctx.classification.type);
    return { score, signals, shouldSkipGV, recommendedTokenBudget };
}

/**
 * 복잡도 점수와 QueryType을 기반으로 권장 토큰 예산을 계산합니다.
 *
 * 알고리즘:
 * 1. 복잡도 점수로 기본 예산 결정 (LOW/MEDIUM/HIGH/UNLIMITED)
 * 2. QueryType별 오버라이드와 비교하여 더 큰 값 채택 (타입 최소 보장)
 * 3. MIN_TOKENS 이상 보장 (0=UNLIMITED 제외)
 */
export function recommendTokenBudget(complexityScore: number, queryType: QueryType): number {
    // 최고 복잡도: 제한 없음
    if (complexityScore >= 0.8) return TOKEN_BUDGETS.UNLIMITED;

    // 복잡도 기반 기본 예산
    let budget: number;
    if (complexityScore < 0.3) {
        budget = TOKEN_BUDGETS.LOW;
    } else if (complexityScore < 0.6) {
        budget = TOKEN_BUDGETS.MEDIUM;
    } else {
        budget = TOKEN_BUDGETS.HIGH;
    }

    // QueryType별 최소 보장 (타입 오버라이드가 더 크면 채택)
    const typeMinimum = TOKEN_BUDGETS.BY_TYPE[queryType];
    if (typeMinimum && typeMinimum > budget) {
        budget = typeMinimum;
    }

    // 최소 토큰 보장
    return Math.max(budget, TOKEN_BUDGETS.MIN_TOKENS);
}
