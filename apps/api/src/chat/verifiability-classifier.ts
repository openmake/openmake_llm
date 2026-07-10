/**
 * ============================================================
 * Verifiability Classifier — Tail 라우팅 축 B
 * ============================================================
 *
 * tail 후보를 "무엇으로 외부 검증이 가능한가"로 분류한다. 이 값이 Stage 2 목적지를 결정하고,
 * 동시에 게이트의 두 번째 필수 조건이다 — 'none'(검증 수단 없음)이면 라우팅하지 않는다
 * (self-critique 로 대체 금지 — A/B 실측에서 자기검증은 7% 발동·자기편향이라 이득 없음).
 *
 * fail-safe: 확실할 때만 분류, 나머지는 'none'(=trunk).
 *
 * @module chat/verifiability-classifier
 */
import type { QueryClassification } from './model-selector-types';
import { TAIL_GATE_PATTERNS } from '../config/routing-config';

export type Verifiability = 'executable' | 'factual' | 'decomposable' | 'none';

const CODE_TYPES = new Set(['code-gen', 'code-agent', 'code']);
const COMPLEX_TYPES = new Set(['analysis', 'reasoning', 'math', 'math-hard', 'math-applied', 'document']);

/**
 * 쿼리가 어떤 외부 신호로 검증 가능한지 분류한다 (우선순위: executable → factual → decomposable → none).
 */
export function classifyVerifiability(
    query: string,
    classification: QueryClassification,
): Verifiability {
    const P = TAIL_GATE_PATTERNS;
    const type = classification.type;

    // 1) executable — 실제로 돌려서 검증 가능한 코드 (순수성 힌트 + 실행불가 제외)
    if (CODE_TYPES.has(type)
        && P.executable_produce.test(query)
        && P.executable_pure_hint.test(query)
        && !P.executable_exclude.test(query)) {
        return 'executable';
    }

    // 2) factual — 외부 사실과 대조 가능한 단정 (주장 + 엔티티, 주관 제외)
    if (P.verifiable_fact.test(query)
        && P.factual_entity.test(query)
        && !P.factual_exclude.test(query)) {
        return 'factual';
    }

    // 3) decomposable — 다소스 리서치로 쪼갤 수 있는 복합 질문
    if (COMPLEX_TYPES.has(type)
        && (P.decomposable.test(query) || P.decomposable_multi.test(query))) {
        return 'decomposable';
    }

    return 'none';
}

/** verifiability → Stage 2 실행 전략 매핑 (셰도우에서는 would_route_to 로만 기록) */
export function verifiabilityToStrategy(v: Verifiability): string {
    switch (v) {
        case 'executable': return 'generate-verify';
        case 'factual': return 'conditional-verify';
        case 'decomposable': return 'deep-research';
        default: return 'single';
    }
}
