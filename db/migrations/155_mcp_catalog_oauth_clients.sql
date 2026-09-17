-- ============================================================
-- 155_mcp_catalog_oauth_clients.sql — 원격 MCP 사전 등록 OAuth 클라이언트 (계획 R-3)
-- ============================================================
-- 동적 등록(RFC 7591)을 받지 않는 인가 서버(GitHub·Google)는 운영자가 provider 콘솔에서 만든 client_id·secret 이
-- 있어야 로그인할 수 있다. 카탈로그 항목당 1개를 두고, McpOAuthProvider 가 사용자별 등록(104)보다 먼저 쓴다.
--
-- 계획 대비: mcp_server_catalog.oauth_client_metadata JSONB 컬럼 대신 별도 테이블 — 카탈로그 목록 조회가
--   비밀값을 싣지 않게 한다. client_secret 은 utils/token-crypto(AES-256-GCM) 암호문만 저장한다.
-- authorization_params: 인가 URL 에 덧붙일 provider 전용 파라미터(Google access_type=offline·prompt=consent 등).
-- ============================================================

CREATE TABLE IF NOT EXISTS mcp_catalog_oauth_clients (
    catalog_id                 TEXT PRIMARY KEY REFERENCES mcp_server_catalog(id) ON DELETE CASCADE,
    client_id                  TEXT NOT NULL,
    client_secret_enc          TEXT,
    token_endpoint_auth_method TEXT CHECK (token_endpoint_auth_method IN ('client_secret_post', 'client_secret_basic', 'none')),
    scope                      TEXT,
    authorization_params       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by                 TEXT,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE mcp_catalog_oauth_clients IS
  '원격 MCP 사전 등록 OAuth 클라이언트(R-3) — 동적 등록 미지원 인가 서버용. secret 은 token-crypto 암호문';
