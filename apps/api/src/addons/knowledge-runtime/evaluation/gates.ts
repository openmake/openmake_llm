/**
 * K08 게이트 판정 — 프로필(eval-profile.json)의 임계값과 측정값을 대조한다.
 * 임계값·blocking 여부는 전부 프로필 데이터에서 온다(코드 리터럴 금지).
 *
 * @module addons/knowledge-runtime/evaluation/gates
 */
import type { EvalProfile } from './types';

export interface GateResult {
    name: string;
    value: number | null;
    bound: string;
    blocking: boolean;
    /** realLlmOnly 인데 --real-llm 미실행 등으로 측정 안 됨 */
    skipped: boolean;
    pass: boolean;
}

export interface GateEvaluation {
    results: GateResult[];
    blockingFailures: number;
    qualityFailures: number;
}

/**
 * 게이트 평가.
 * @param values 게이트명 → 측정값(null 이면 표본 없음)
 * @param present 게이트명 → 측정을 수행했는가(realLlmOnly 게이트가 --real-llm 없이 스킵되는 경우 false)
 */
export function evaluateGates(profile: EvalProfile, values: Record<string, number | null>, present: Record<string, boolean>): GateEvaluation {
    const results: GateResult[] = [];
    let blockingFailures = 0;
    let qualityFailures = 0;

    for (const [name, spec] of Object.entries(profile.gates)) {
        const measured = present[name] !== false;
        if (spec.realLlmOnly && !measured) {
            results.push({ name, value: null, bound: describeBound(spec), blocking: spec.blocking, skipped: true, pass: true });
            continue;
        }
        const value = values[name] ?? null;
        let pass: boolean;
        let skipped = false;
        if (value === null) {
            // min 게이트에서 표본이 없으면 판정 불가(스킵), max 게이트에서 null 은 0 취급(위반 없음).
            if (spec.min !== undefined) { skipped = true; pass = true; }
            else pass = true;
        } else if (spec.max !== undefined) {
            pass = value <= spec.max;
        } else if (spec.min !== undefined) {
            pass = value >= spec.min;
        } else {
            pass = true;
        }
        results.push({ name, value, bound: describeBound(spec), blocking: spec.blocking, skipped, pass });
        if (!pass && !skipped) {
            if (spec.blocking) blockingFailures += 1;
            else qualityFailures += 1;
        }
    }
    return { results, blockingFailures, qualityFailures };
}

function describeBound(spec: { max?: number; min?: number }): string {
    if (spec.max !== undefined) return `≤ ${spec.max}`;
    if (spec.min !== undefined) return `≥ ${spec.min}`;
    return '—';
}
