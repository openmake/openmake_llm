-- ============================================================
-- 029_consent_logs.sql — GDPR Phase A Fix 4 (consent 이력 추적)
-- ============================================================
--
-- 회원가입 시 Privacy Policy / Terms of Service 동의 이력 보관.
-- GDPR Article 7(1) (consent demonstrability) 요건 충족.
--
-- 운영 의미:
--   - 각 사용자의 동의 시점 / 버전 / locale / IP / User-Agent 기록
--   - 동일 사용자가 같은 type 에 대해 여러 row 가능 (Phase B 의 정책 갱신
--     재동의 / 동의 철회 후 재동의 등) — 시간 정렬 후 latest 가 현재 상태
--   - ON DELETE CASCADE: 사용자 탈퇴 시 동의 이력 함께 삭제 (Article 5(1)(e)
--     storage limitation 정합, prefer right-to-erasure)
--
-- ============================================================

CREATE TABLE IF NOT EXISTS consent_logs (
    id              SERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type    TEXT NOT NULL CHECK (consent_type IN ('privacy_policy', 'terms_of_service')),
    consent_version TEXT NOT NULL,
    consent_locale  TEXT NOT NULL,
    granted         BOOLEAN NOT NULL DEFAULT TRUE,
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address      TEXT,
    user_agent      TEXT
);

-- 사용자별 type 별 최신 동의 상태 조회 최적화 (Phase B 동의 철회 UI 에서 사용)
CREATE INDEX IF NOT EXISTS idx_consent_logs_user
    ON consent_logs(user_id, consent_type, granted_at DESC);

COMMENT ON TABLE consent_logs IS 'GDPR Article 7(1) consent demonstrability — 사용자별 정책 동의 이력';
COMMENT ON COLUMN consent_logs.consent_version IS '정책 markdown frontmatter version 필드 (예: "1.0")';
COMMENT ON COLUMN consent_logs.granted IS '동의 부여(TRUE) / 철회(FALSE) — 시간 정렬 후 latest 가 현재 상태';
