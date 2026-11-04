/**
 * 절차 스킬 저장 전 구조 검사 — 재생하면 반드시 실패할 본문(알 수 없는 액션, 빈 단계, 필수 값 누락, 빈 코드)을
 * 저장 시점에 오류로 돌려 모델이 고쳐서 다시 저장하게 한다. 의존성이 없는 순수 모듈이다.
 * 이동 주소(사설망 등) 검사는 도구 쪽이 browser-url-guard 로 한다 — 여기서는 검사 대상 액션만 고른다.
 *
 * @module services/agent-task/procedural-structure
 */
import { flattenBrowserActions, validateBrowserFlow } from '@openmake/config';
import { PROCEDURAL_STRUCTURE } from '../../config/agent-task-skill-memory';
import { PROCEDURAL_STRUCTURE_PROBLEMS as P } from '../../prompts/agent-task-skill-memory';

interface StructureInput {
    kind: 'browser' | 'script';
    actions?: readonly unknown[];
    code?: string;
}

/** PURE: 구조 문제 목록(비어 있으면 저장해도 된다). */
export function findStructureProblems(spec: StructureInput): string[] {
    if (spec.kind === 'script') return (spec.code ?? '').trim() ? [] : [P.emptyCode()];
    if ((spec.actions ?? []).length === 0) return [P.noActions()];
    // if·repeat 는 형태를 먼저 보고, 단계 검사는 펼친 액션으로 한다(위치는 펼친 목록 기준).
    const flowError = validateBrowserFlow(spec.actions);
    if (flowError) return [flowError];
    const actions = flattenBrowserActions(spec.actions);
    const known = PROCEDURAL_STRUCTURE.ACTION_REQUIRED_FIELDS;
    const problems: string[] = [];
    actions.forEach((a, i) => {
        const o = a && typeof a === 'object' ? a as Record<string, unknown> : null;
        if (!o || typeof o.type !== 'string' || !o.type.trim()) { problems.push(P.emptyStep(i)); return; }
        if (!Object.prototype.hasOwnProperty.call(known, o.type)) { problems.push(P.unknownAction(i, o.type, Object.keys(known))); return; }
        for (const field of known[o.type]) {
            if (typeof o[field] !== 'string' || !(o[field] as string).trim()) problems.push(P.missingField(i, o.type, field));
        }
    });
    return problems;
}

/** PURE: 저장 때 주소를 검사할 goto 액션(if·repeat 본문 포함) — {{param}} 이 든 주소는 값이 정해지는 재생 때 검사한다. 형태 검사를 통과한 액션만 받는다. */
export function staticGotoActions(actions: readonly unknown[]): unknown[] {
    return flattenBrowserActions(actions).filter((a) => {
        const o = a && typeof a === 'object' ? a as { type?: unknown; url?: unknown } : null;
        return o?.type === 'goto' && typeof o.url === 'string' && !o.url.includes('{{');
    });
}
