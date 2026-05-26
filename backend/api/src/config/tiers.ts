/**
 * ============================================================
 * Tier ordering — 등급 비교 공용 SoT
 * ============================================================
 * 카탈로그 (mcp_server_catalog.required_tier), 사용자 (users.tier),
 * 도구 접근 제어 (tool-router.filterByTier) 등 등급 비교가 필요한 모든 곳에서 import.
 *
 * Order: free < starter < standard < pro < enterprise.
 * `indexOf` 비교로 게이트 — 작은 값 ≥ 인덱스가 필요 등급.
 *
 * @module config/tiers
 */

/** 카탈로그/사용자 등급 비교 순서 — 작은 인덱스가 낮은 등급. */
export const MCP_CATALOG_TIER_ORDER = ['free', 'starter', 'standard', 'pro', 'enterprise'] as const;

export type CatalogTier = typeof MCP_CATALOG_TIER_ORDER[number];
