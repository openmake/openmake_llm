-- 142: 채팅 요청 사실 테이블 (2026-09-17, F24.2 + F24.8 SLI 소스)
-- 요청당 1행 — 시스템 프롬프트·도구 매니페스트 지문(sha256)과 결과(상태·TTFT·토큰·비용). 본문·가변 블록 원문은 저장하지 않는다.
-- prompt_fingerprints 는 지문 → 원문(정적 prefix·도구 매니페스트만) — "이 응답이 어떤 프롬프트/도구로 나왔나" 복원용.
CREATE TABLE IF NOT EXISTS chat_requests (
    request_id          TEXT PRIMARY KEY,
    trace_id            TEXT,
    user_id             TEXT,
    session_id          TEXT,
    started_at          TIMESTAMPTZ NOT NULL,
    finished_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status              TEXT NOT NULL CHECK (status IN ('ok', 'error', 'aborted')),
    error_code          TEXT,
    provider_id         TEXT,
    model               TEXT,
    app_version         TEXT,
    git_hash            TEXT,
    prompt_static_hash  CHAR(64),
    prompt_full_hash    CHAR(64),
    prompt_blocks       TEXT[] NOT NULL DEFAULT '{}',
    tool_manifest_hash  CHAR(64),
    tool_names          TEXT[] NOT NULL DEFAULT '{}',
    ttft_ms             INTEGER,
    prep_ms             INTEGER,
    total_ms            INTEGER,
    tool_ms             INTEGER,
    tool_turns          SMALLINT,
    input_tokens        INTEGER,
    output_tokens       INTEGER,
    cost_usd_micros     BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_requests_started ON chat_requests (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_requests_status_started ON chat_requests (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_requests_prompt_hash ON chat_requests (prompt_static_hash, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_requests_model ON chat_requests (model, started_at DESC);
COMMENT ON TABLE chat_requests IS '채팅 요청 사실 테이블 — 프롬프트/도구 지문(F24.2) + 결과(SLI, F24.8). 본문 미저장(142)';

CREATE TABLE IF NOT EXISTS prompt_fingerprints (
    hash        CHAR(64) PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('prompt_static', 'tool_manifest')),
    content     TEXT NOT NULL,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    app_version TEXT
);
COMMENT ON TABLE prompt_fingerprints IS '지문 → 원문(정적 prefix·도구 매니페스트만, 가변 블록 제외)(142)';
