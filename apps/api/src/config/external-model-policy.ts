/**
 * 외부 모델 정책 (Control Plane 기초, 2026-09-16) — 관리자가 정하는 외부 provider/모델 허용·차단 목록.
 *
 * 설정 키 `EXTERNAL_MODEL_POLICY`(system_settings, JSON):
 *   {"deny": ["openrouter:*", "nvidia:meta/*"], "allow": ["chatgpt:*"]}
 * - 패턴은 fullId(`provider:model`)에 대한 글롭(`*` = 임의 문자열). 대소문자 무시.
 * - deny 가 이긴다. allow 가 비어 있지 않으면 allow 에 맞는 것만 통과한다.
 * - 로컬(`local-llm`)은 정책 대상이 아니다(항상 허용).
 * 결정적 규칙 — provider gate(services/chat-service/provider-gate)가 resolve 직후 강제한다.
 *
 * @module config/external-model-policy
 */
export interface ExternalModelPolicy {
    allow: string[];
    deny: string[];
}

const EMPTY: ExternalModelPolicy = { allow: [], deny: [] };

/** PURE: 원문(JSON) → 정책. 형태가 어긋나면 빈 정책(전부 허용). */
export function parseExternalModelPolicy(raw: string | undefined): ExternalModelPolicy {
    if (!raw || !raw.trim()) return EMPTY;
    try {
        const o = JSON.parse(raw) as { allow?: unknown; deny?: unknown };
        const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []);
        return { allow: list(o?.allow), deny: list(o?.deny) };
    } catch { return EMPTY; }
}

function globToRegExp(glob: string): RegExp {
    return new RegExp(`^${glob.split('*').map((s) => s.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('.*')}$`, 'i');
}

/** PURE: fullId 가 정책상 허용되는가. */
export function isExternalModelAllowed(fullId: string, policy: ExternalModelPolicy): boolean {
    if (policy.deny.some((p) => globToRegExp(p).test(fullId))) return false;
    if (policy.allow.length > 0) return policy.allow.some((p) => globToRegExp(p).test(fullId));
    return true;
}

let cache: { raw: string | undefined; policy: ExternalModelPolicy } | null = null;

/** 원문이 바뀔 때만 다시 파싱 — 호출당 JSON.parse 를 피한다. */
export function resolveExternalModelPolicy(raw: string | undefined): ExternalModelPolicy {
    if (cache && cache.raw === raw) return cache.policy;
    cache = { raw, policy: parseExternalModelPolicy(raw) };
    return cache.policy;
}
