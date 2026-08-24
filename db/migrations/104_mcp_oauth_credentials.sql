-- Migration 104 — 원격 MCP 서버 OAuth 자격증명 (2026-08-25)
--
-- 확장으로 설치되는 원격 MCP(Linear·Asana·Slack·Figma·Atlassian 등)는 전부 OAuth 를
-- 요구한다(401 invalid_token / missing_token). SDK 는 `authProvider` 로 Authorization Code +
-- PKCE + 동적 클라이언트 등록(RFC 7591)을 지원하지만 이 레포는 배선한 적이 없어, 승인해도
-- 영영 도구 0개였다 (#616 에서 원인만 노출).
--
-- 사용자×서버 단위로 ① 동적 등록된 client 정보 ② 토큰을 보관한다. 토큰·client_secret 은
-- AES-256-GCM(utils/token-crypto, `v1:` 접두) 으로 암호화해 컬럼에 담는다 — 외부 provider
-- BYOK 키와 같은 방식. state·PKCE verifier 는 수명이 분 단위라 KV(storage/) 에 두고 여기엔 없다.
--
-- 멱등 (IF NOT EXISTS + DO/EXCEPTION 제약 가드).

CREATE TABLE IF NOT EXISTS mcp_oauth_credentials (
    mcp_server_id     TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- RFC 7591 동적 등록 결과 (client_id 등). client_secret 은 별도 암호화 컬럼.
    client_info       JSONB,
    client_secret_enc TEXT,
    -- OAuthTokens JSON 전체를 암호화한 문자열 (access/refresh/scope/expires_in)
    tokens_enc        TEXT,
    -- 만료 판정용 (expires_in 을 저장 시각 기준으로 절대시각화). 조회 편의 — 진실은 tokens_enc.
    token_expires_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (mcp_server_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_credentials_user ON mcp_oauth_credentials (user_id);
