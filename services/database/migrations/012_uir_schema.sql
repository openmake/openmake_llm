-- ============================================================
-- 012_uir_schema.sql - Unified Intent Router 스키마
-- ============================================================
--
-- UIR(Unified Intent Router) 운영에 필요한 테이블:
-- 1. uir_shadow_log     - shadow mode 비교 결과 로그
-- 2. uir_rollout_config - A/B 롤아웃 설정
-- 3. uir_perf_stats     - 성능 집계 통계 (선택적)
-- ============================================================

INSERT INTO migration_versions (version, filename)
VALUES ('012', '012_uir_schema.sql')
ON CONFLICT (version) DO NOTHING;

-- ── 1. Shadow Mode 비교 로그 ─────────────────────────────────

CREATE TABLE IF NOT EXISTS uir_shadow_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    VARCHAR(255),
    user_id       VARCHAR(255),
    query_hash    CHAR(64)     NOT NULL,  -- SHA256(query) — 개인정보 보호

    -- UIR 라우팅 결과
    uir_query_type      VARCHAR(50),
    uir_agent_id        VARCHAR(100),
    uir_brand_profile   VARCHAR(50),
    uir_complexity      NUMERIC(4,3),
    uir_recommended_tools JSONB DEFAULT '[]',
    uir_confidence      NUMERIC(4,3),
    uir_latency_ms      INTEGER,

    -- Legacy 라우팅 결과 (비교용)
    legacy_query_type   VARCHAR(50),
    legacy_agent_id     VARCHAR(100),
    legacy_brand_profile VARCHAR(50),

    -- 비교 결과
    agent_match         BOOLEAN,
    query_type_match    BOOLEAN,
    profile_match       BOOLEAN,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uir_shadow_log_created
    ON uir_shadow_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uir_shadow_log_session
    ON uir_shadow_log (session_id)
    WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_uir_shadow_log_user
    ON uir_shadow_log (user_id)
    WHERE user_id IS NOT NULL;

-- ── 2. A/B 롤아웃 설정 ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS uir_rollout_config (
    id              SERIAL PRIMARY KEY,
    rollout_percent INTEGER     NOT NULL DEFAULT 0
                    CHECK (rollout_percent BETWEEN 0 AND 100),
    enabled         BOOLEAN     NOT NULL DEFAULT FALSE,
    description     TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      VARCHAR(255)
);

-- 초기 시드: shadow mode만 (rollout 0%)
INSERT INTO uir_rollout_config (rollout_percent, enabled, description, updated_by)
VALUES (0, FALSE, 'Initial config — shadow mode only, UIR not active', 'system')
ON CONFLICT DO NOTHING;

-- ── 3. 일별 성능 집계 ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS uir_perf_stats (
    stat_date           DATE        NOT NULL,
    total_requests      INTEGER     NOT NULL DEFAULT 0,
    shadow_requests     INTEGER     NOT NULL DEFAULT 0,
    agent_match_count   INTEGER     NOT NULL DEFAULT 0,
    qtype_match_count   INTEGER     NOT NULL DEFAULT 0,
    avg_uir_latency_ms  NUMERIC(8,2),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (stat_date)
);

-- ============================================================
-- 검증 쿼리 (수동 실행)
-- ============================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE 'uir_%';
-- SELECT indexname FROM pg_indexes WHERE tablename LIKE 'uir_%';
-- SELECT * FROM uir_rollout_config;
