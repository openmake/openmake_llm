-- 137: 월 명세서 물질화 (F25 PR-5, 2026-09-17)
-- 원장(cost_ledger)을 월·주체 단위로 압축한 헤더+라인. 지난달은 정산 잡이 멱등 upsert, 당월은 on-demand 집계. 멱등.
CREATE TABLE IF NOT EXISTS billing_statements (
    id               BIGSERIAL PRIMARY KEY,
    subject_type     TEXT NOT NULL CHECK (subject_type IN ('user', 'org', 'system')),
    subject_id       TEXT NOT NULL,
    period_start     DATE NOT NULL,
    period_end       DATE NOT NULL,
    total_usd_micros BIGINT NOT NULL,
    generated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (subject_type, subject_id, period_start)
);
CREATE TABLE IF NOT EXISTS billing_statement_lines (
    statement_id BIGINT NOT NULL REFERENCES billing_statements(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    rate_key     TEXT NOT NULL,
    unit         TEXT NOT NULL,
    quantity     NUMERIC(20,6) NOT NULL,
    usd_micros   BIGINT NOT NULL,
    PRIMARY KEY (statement_id, kind, rate_key, unit)
);
COMMENT ON TABLE billing_statements IS '월 명세서 헤더 — 주체(user|org|system)×월 유니크, 라인은 kind×rate_key×unit (137)';
