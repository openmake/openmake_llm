/**
 * 비용 회계 kind·단위 (F25 PR-1, 2026-09-17) — switch 대신 Record 룩업(No-Hardcoding ⑤).
 *
 * 원장(cost_ledger)의 kind 는 여기 등록된 값만 쓴다. 단가 해석은 services/cost/cost-ledger-service.
 *   llm.local            로컬 vLLM 토큰 — 단가는 DB cost_rates(rate_key = 모델 id | '*') → env LOCAL_LLM_COST_* → 0
 *   llm.external         외부 provider 토큰 — DB → config/external-pricing 상수표 → 0 (BYOK/서버 키 구분은 cost_owner)
 *   tool.web_search      웹 검색 호출(provider 별 rate_key)
 *   media.image.generate 이미지 장수 · media.video.generate 초 · media.audio.speech 문자
 *   storage.generated    /generated 보관량(GB·일)
 *   search.embed / search.rerank  임베딩·재순위 호출
 *
 * @module config/cost-kinds
 */
export type CostUnit = 'token_in' | 'token_out' | 'token_think' | 'call' | 'image' | 'second' | 'char' | 'gb_day';

export const COST_KINDS = {
    'llm.local': { units: ['token_in', 'token_out'] },
    'llm.external': { units: ['token_in', 'token_out', 'token_think'] },
    'tool.web_search': { units: ['call'] },
    'media.image.generate': { units: ['image'] },
    'media.video.generate': { units: ['second'] },
    'media.audio.speech': { units: ['char'] },
    'storage.generated': { units: ['gb_day'] },
    'search.embed': { units: ['call'] },
    'search.rerank': { units: ['call'] },
} as const satisfies Record<string, { units: readonly CostUnit[] }>;

export type CostKind = keyof typeof COST_KINDS;
export type CostOwner = 'user' | 'server' | 'byok';

export const COST_KIND_LIST = Object.keys(COST_KINDS) as CostKind[];

export function isCostKind(v: string): v is CostKind {
    return Object.prototype.hasOwnProperty.call(COST_KINDS, v);
}

/** kind 내 단가 폴백 rate_key */
export const COST_RATE_WILDCARD = '*';
