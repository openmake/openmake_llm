/**
 * notebooklm add-on 설정 (L2) — 종전 config/runtime-limits.ts 에서 옮겼다(2026-09-19).
 *
 * @module addons/notebooklm/config
 */

/**
 * NotebookLM composer 연동 (routes/notebooklm.routes.ts).
 *
 * TEMPLATE_ID: 카탈로그(mcp_server_catalog) 의 NotebookLM 템플릿 id — 유저의 설치 서버
 *   row 를 catalog_template_id 로 찾을 때 사용 (076 시드와 동일 값).
 * LIST_CACHE_TTL_MS: 노트북 목록 캐시 TTL. NotebookLM RPC 왕복이 2~4초라 composer
 *   picker 열 때마다 왕복하지 않도록 캐싱한다. ?refresh=1 로 무효화 가능.
 * LIST_CACHE_MAX: per-user 캐시 엔트리 상한 (LRU).
 */
export const NOTEBOOKLM_INTEGRATION = {
    TEMPLATE_ID: process.env.NOTEBOOKLM_CATALOG_TEMPLATE_ID || 'mcp-notebooklm',
    LIST_CACHE_TTL_MS: parseInt(process.env.NOTEBOOKLM_LIST_CACHE_TTL_MS || '300000', 10),
    LIST_CACHE_MAX: parseInt(process.env.NOTEBOOKLM_LIST_CACHE_MAX || '500', 10),
} as const;
