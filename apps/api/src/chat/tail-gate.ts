/**
 * ============================================================
 * Tail Gate — Stage 1 결정 진입점
 * ============================================================
 *
 * 축 A(errorScore) × 축 B(verifiability)를 결합해 tail 여부를 판정한다.
 *   isTail = errorScore ≥ θ  AND  verifiability ≠ 'none'
 * (트래픽 캡은 셰도우 이후 실제 라우팅 활성화 단계에서 적용 — 셰도우는 캡 없이 전량 관측.)
 *
 * 무-LLM · 순수 함수. classifyQuery(regex)로 자체 분류하므로 executionPlan 내부에 의존하지 않는다.
 *
 * @module chat/tail-gate
 */
import { classifyQuery } from './query-classifier';
import { assessErrorLikelihood } from './error-likelihood-assessor';
import { classifyVerifiability, verifiabilityToStrategy, type Verifiability } from './verifiability-classifier';
import { TAIL_THRESHOLD } from '../config/routing-config';

export interface TailDecision {
    isTail: boolean;
    errorScore: number;
    errorSignals: string[];
    verifiability: Verifiability;
    /** 실제 라우팅 시 갈 전략 (셰도우에서는 기록만) */
    wouldRouteTo: string;
    queryType: string;
    confidence: number;
}

/**
 * 쿼리에 대해 tail 게이트를 평가한다 (무-LLM).
 */
export function evaluateTailGate(query: string): TailDecision {
    const classification = classifyQuery(query);
    const { score, signals } = assessErrorLikelihood(query, classification);
    const verifiability = classifyVerifiability(query, classification);

    const isTail = score >= TAIL_THRESHOLD && verifiability !== 'none';

    return {
        isTail,
        errorScore: score,
        errorSignals: signals,
        verifiability,
        wouldRouteTo: isTail ? verifiabilityToStrategy(verifiability) : 'single',
        queryType: classification.type,
        confidence: classification.confidence,
    };
}
