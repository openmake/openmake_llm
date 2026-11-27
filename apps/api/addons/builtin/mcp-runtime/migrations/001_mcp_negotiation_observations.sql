-- MCP 협상 관측(MCP-1, 2026-11-27) — 서버별 마지막 협상 결과. 네임스페이스 addon:mcp-runtime:001. 멱등.
--
-- 기록은 MCP_NEGOTIATION_OBSERVE_ENABLED(기본 OFF)일 때만 쌓인다 — 표가 있다고 동작이 바뀌지 않는다.
-- 서버당 1행(마지막 연결 기준)이고 서버 행이 지워지면 함께 지워진다(사용자 삭제 → mcp_servers CASCADE).
-- URL·명령·env·토큰·client_id 는 저장하지 않는다 — 분류값과 서버가 스스로 밝힌 이름·버전·선언만.
CREATE TABLE IF NOT EXISTS mcp_negotiation_observations (
    server_id         TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
    transport         TEXT NOT NULL,
    auth_method       TEXT NOT NULL,
    protocol_era      TEXT,
    protocol_version  TEXT,
    sdk_generation    TEXT NOT NULL,
    capabilities      JSONB NOT NULL DEFAULT '[]'::jsonb,
    extensions        JSONB NOT NULL DEFAULT '[]'::jsonb,
    server_name       TEXT,
    server_version    TEXT,
    first_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    observed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    observation_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_mcp_negotiation_observations_observed_at
    ON mcp_negotiation_observations (observed_at DESC);
