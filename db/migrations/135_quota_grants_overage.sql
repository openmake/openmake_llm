-- 135: 쿼터 추가 한도(부여)·초과 승인 요청 (F25 PR-3b, 2026-09-17)
--
-- quota_grants: 특정 윈도우 버킷에 더해지는 토큰(유효 한도 = 설정 한도 + grants 합). kind
--   rollover(직전 버킷 미사용분 이월, 첫 예약 시 지연 생성·멱등) | approval(초과 요청 승인) | manual(관리자 수동).
-- quota_overage_requests: 초과 시 자동/수동 생성되는 요청 — 사용자·윈도우·버킷당 pending 1건(부분 유니크).
-- 멱등.

CREATE TABLE IF NOT EXISTS quota_grants (
    id           BIGSERIAL PRIMARY KEY,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'org')),
    subject_id   TEXT NOT NULL,
    dimension    TEXT NOT NULL DEFAULT 'tokens' CHECK (dimension IN ('tokens', 'cost_micros')),
    "window"     TEXT NOT NULL CHECK ("window" IN ('hourly', 'weekly', 'monthly')),
    bucket       TEXT NOT NULL,
    amount       BIGINT NOT NULL CHECK (amount > 0),
    kind         TEXT NOT NULL CHECK (kind IN ('rollover', 'approval', 'manual')),
    source_id    TEXT NOT NULL DEFAULT '',
    created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (subject_type, subject_id, dimension, "window", bucket, kind, source_id)
);
CREATE INDEX IF NOT EXISTS idx_quota_grants_lookup ON quota_grants (subject_type, subject_id, "window", bucket);

CREATE TABLE IF NOT EXISTS quota_overage_requests (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dimension        TEXT NOT NULL DEFAULT 'tokens',
    "window"         TEXT NOT NULL CHECK ("window" IN ('hourly', 'weekly', 'monthly')),
    bucket           TEXT NOT NULL,
    requested_amount BIGINT NOT NULL CHECK (requested_amount > 0),
    reason           TEXT,
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    auto_created     BOOLEAN NOT NULL DEFAULT FALSE,
    decided_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
    decided_at       TIMESTAMPTZ,
    granted_amount   BIGINT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quota_overage_pending
    ON quota_overage_requests (user_id, dimension, "window", bucket) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_quota_overage_status ON quota_overage_requests (status, created_at DESC);

COMMENT ON TABLE quota_grants IS '쿼터 추가 한도 — 유효 한도 = 설정 한도 + 해당 윈도우 버킷 grants 합 (135)';
COMMENT ON TABLE quota_overage_requests IS '쿼터 초과 승인 요청 — 승인 시 quota_grants(kind approval) 생성 (135)';
