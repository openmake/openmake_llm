/**
 * ============================================================
 * Error-Likelihood Assessor — Tail 라우팅 축 A
 * ============================================================
 *
 * "쿼리가 복잡한가"가 아니라 "모델이 이 답을 틀릴 가능성이 높은가"를 무-LLM 피처로 점수화한다.
 * (복잡도 ≠ 실패율 — A/B 실측에서 qwen3.6은 복잡한 표준 알고리즘도 단발로 다 맞혔다.
 *  그래서 표준/교과서 패턴은 감점, 다중 제약·검증가능 팩트·novelty 는 가점.)
 *
 * 반드시 무-LLM. LLM 이 필요하면 그건 Stage 2 다.
 *
 * @module chat/error-likelihood-assessor
 */
import type { QueryClassification } from './model-selector-types';
import { ERROR_LIKELIHOOD_NEUTRAL, ERROR_LIKELIHOOD_WEIGHTS, TAIL_GATE_PATTERNS } from '../config/routing-config';

export interface ErrorLikelihood {
    /** 오류 가능성 점수 (0.0~1.0) */
    score: number;
    /** 발동한 시그널 목록 (셰도우 튜닝 근거) */
    signals: string[];
}

/**
 * 쿼리가 모델이 틀릴 법한 유형인지 무-LLM 피처로 평가한다.
 */
export function assessErrorLikelihood(
    query: string,
    classification: QueryClassification,
): ErrorLikelihood {
    const W = ERROR_LIKELIHOOD_WEIGHTS;
    const P = TAIL_GATE_PATTERNS;
    let score = ERROR_LIKELIHOOD_NEUTRAL;
    const signals: string[] = [];

    const add = (delta: number, sig: string) => { score += delta; signals.push(sig); };

    // ── 감점: 모델이 잘 하는 영역 ──
    if (P.textbook_algo.test(query)) add(W.TEXTBOOK_ALGO, 'textbook_algo');
    if (query.length < W.VERY_SHORT_THRESHOLD) add(W.VERY_SHORT, 'very_short');
    if (P.subjective.test(query)) add(W.SUBJECTIVE, 'subjective');

    // ── 가점: 틀리기 쉬운 영역 ──
    if (P.multi_constraint.test(query)) add(W.MULTI_CONSTRAINT, 'multi_constraint');
    if (P.verifiable_fact.test(query)) add(W.VERIFIABLE_FACT, 'verifiable_fact');
    if (P.novelty_ood.test(query)) add(W.NOVELTY_OOD, 'novelty_ood');
    if (classification.confidence < W.LOW_CONFIDENCE_THRESHOLD) add(W.LOW_CONFIDENCE, 'low_confidence');
    if (P.numeric_exact.test(query)) add(W.NUMERIC_EXACT, 'numeric_exact');

    return { score: Math.max(0, Math.min(1, score)), signals };
}
