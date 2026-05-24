-- ============================================================
-- 030_guardian_consent.sql — GDPR Phase D (14세 미만 셀프 동의)
-- ============================================================
--
-- 정통망법 §31 + 개보법 §39-3 (한국 14세 미만) / GDPR Article 8
-- (EU 16세, member state 13세 lower) 의 법정대리인 동의 의무 구현.
--
-- 정책: Option 3 (이메일 캐프쳐 + 운영자 수동 verify)
--   - 회원가입 시 birthDate 수집
--   - locale 별 임계값 미달 시 guardian_email 추가 수집
--   - users.minor_status='minor_pending' + is_active=false
--   - 운영자가 admin endpoint 로 verify → is_active=true
--
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS minor_status TEXT
    NOT NULL DEFAULT 'adult'
    CHECK (minor_status IN ('adult', 'minor_pending', 'minor_verified', 'minor_rejected'));

CREATE TABLE IF NOT EXISTS guardian_consent_pending (
    id                   SERIAL PRIMARY KEY,
    user_id              TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    guardian_email       TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'verified', 'rejected', 'expired')),
    reason               TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at          TIMESTAMPTZ,
    verified_by_admin_id TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_guardian_pending_status
    ON guardian_consent_pending(status)
    WHERE status = 'pending';

COMMENT ON TABLE guardian_consent_pending IS '14세 미만 가입 시 법정대리인 동의 보류 큐 — 정통망법 §31, GDPR Article 8';
COMMENT ON COLUMN users.minor_status IS 'adult | minor_pending (대기) | minor_verified (운영자 승인) | minor_rejected (운영자 거부)';
