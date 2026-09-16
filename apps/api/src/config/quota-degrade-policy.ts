/**
 * 쿼터 초과 시 강등 정책 (F25 PR-3a, 2026-09-17).
 *
 * `QUOTA_EXCEEDED_ACTION` = reject(현행, 429) | degrade — degrade 면 로컬 쿼터 초과 시
 * `QUOTA_DEGRADE_MODEL_MAP`(JSON, 글롭 → 대체 fullId)으로 다른 모델에 재해석한다.
 *   예: {"local-llm:*": "openrouter:meta-llama/llama-3.3-70b-instruct:free"}
 * 첫 매칭 글롭이 이긴다(선언 순). 자기 자신으로의 강등은 무시. 대체 모델도 외부 모델 정책(allow/deny)을
 * 통과해야 하며, 통과 못 하면 reject 로 돌아간다(provider-gate 가 던지는 오류를 그대로 전파하지 않고 원래 429).
 *
 * @module config/quota-degrade-policy
 */
import { globToRegExp } from './external-model-policy';

export type QuotaExceededAction = 'reject' | 'degrade';

export type DegradeMap = Array<{ pattern: RegExp; source: string; target: string }>;

/** PURE: 원문(JSON 객체) → 규칙 목록. 형태가 어긋나면 빈 목록(강등 없음). */
export function parseDegradeMap(raw: string | undefined): DegradeMap {
    if (!raw || !raw.trim()) return [];
    try {
        const o = JSON.parse(raw) as Record<string, unknown>;
        if (!o || typeof o !== 'object' || Array.isArray(o)) return [];
        return Object.entries(o)
            .filter(([k, v]) => typeof v === 'string' && v.trim() !== '' && k.trim() !== '')
            .map(([k, v]) => ({ pattern: globToRegExp(k.trim()), source: k.trim(), target: (v as string).trim() }));
    } catch { return []; }
}

/** PURE: fullId 에 맞는 첫 규칙의 대체 fullId. 없거나 자기 자신이면 null. */
export function resolveDegradeTarget(fullId: string, map: DegradeMap): string | null {
    for (const rule of map) {
        if (rule.pattern.test(fullId)) return rule.target.toLowerCase() === fullId.toLowerCase() ? null : rule.target;
    }
    return null;
}

let cache: { raw: string | undefined; map: DegradeMap } | null = null;
/** 원문이 바뀔 때만 다시 파싱. */
export function resolveDegradeMap(raw: string | undefined): DegradeMap {
    if (cache && cache.raw === raw) return cache.map;
    cache = { raw, map: parseDegradeMap(raw) };
    return cache.map;
}
