/**
 * ============================================================
 * Complexity Assessor - 쿼리 복잡도 기반 토큰 예산
 * ============================================================
 *
 * 복잡도 점수 기반 권장 토큰 예산을 계산합니다.
 * (구 assessComplexity/GV 게이팅은 strategy 계층 폐기 잔재로 제거 — 2026-08-22)
 *
 * @module chat/complexity-assessor
 */

import type { QueryType } from './model-selector-types';
import { TOKEN_BUDGETS } from '../config/llm-parameters';

/**
 * 복잡도 점수와 QueryType을 기반으로 권장 토큰 예산을 계산합니다.
 *
 * 알고리즘:
 * 1. 복잡도 점수로 기본 예산 결정 (LOW/MEDIUM/HIGH/UNLIMITED)
 * 2. QueryType별 오버라이드와 비교하여 더 큰 값 채택 (타입 최소 보장)
 * 3. MIN_TOKENS 이상 보장 (0=UNLIMITED 제외)
 */
export function recommendTokenBudget(complexityScore: number, queryType: QueryType): number {
    // 최고 복잡도: 유한 상한(runaway/비용 방지). 과거 UNLIMITED(0)=무제한을 대체.
    if (complexityScore >= TOKEN_BUDGETS.SCORE_THRESHOLDS.MAX_MIN) return TOKEN_BUDGETS.MAX;

    // 복잡도 기반 기본 예산
    let budget: number;
    if (complexityScore < TOKEN_BUDGETS.SCORE_THRESHOLDS.LOW_MAX) {
        budget = TOKEN_BUDGETS.LOW;
    } else if (complexityScore < TOKEN_BUDGETS.SCORE_THRESHOLDS.MEDIUM_MAX) {
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
