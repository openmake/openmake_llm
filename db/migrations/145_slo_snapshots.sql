-- 145: SLO 스냅샷 (2026-09-17, F24.8) — 5분 평가 tick 결과. 관리자 /admin/slo 추이·에러 버짓 잔량, 400일 보존
CREATE TABLE IF NOT EXISTS slo_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    slo_id              TEXT NOT NULL,          -- chat_availability | chat_ttft_p95 | agent_task_success | eval_pass
    window_hours        INTEGER NOT NULL,
    target              DOUBLE PRECISION NOT NULL,
    sli_value           DOUBLE PRECISION,
    sample_count        INTEGER NOT NULL DEFAULT 0,
    budget_remaining    DOUBLE PRECISION,       -- 0.0~1.0
    burn_rate_fast      DOUBLE PRECISION,
    burn_rate_slow      DOUBLE PRECISION,
    state               TEXT NOT NULL CHECK (state IN ('ok', 'warning', 'critical', 'insufficient'))
);
CREATE INDEX IF NOT EXISTS idx_slo_snapshots_lookup ON slo_snapshots (slo_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_slo_snapshots_computed ON slo_snapshots (computed_at);
COMMENT ON TABLE slo_snapshots IS 'SLO 평가 스냅샷(145) — config/slo, monitoring/slo-runner';
