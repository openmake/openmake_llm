-- 130: 설정·조직 정책 변경 이력 (F22 Phase D, 2026-09-17)
--
-- system_settings(092) 와 organization_policies(129) 는 현재 값만 갖는다(updated_by/updated_at 1행).
-- 누가·언제·무엇을 어떤 값에서 어떤 값으로 바꿨는지를 별도 이력으로 남긴다. 시크릿 키의 값은 '***' 로만 기록.
-- 보존은 data/db-retention.ts (POLICY_HISTORY_RETENTION_DAYS, 기본 365일). 멱등.

CREATE TABLE IF NOT EXISTS system_settings_history (
    id         BIGSERIAL PRIMARY KEY,
    key        TEXT NOT NULL,
    old_value  TEXT,
    new_value  TEXT,
    changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system_settings_history_key ON system_settings_history (key, changed_at DESC);

CREATE TABLE IF NOT EXISTS organization_policy_history (
    id         BIGSERIAL PRIMARY KEY,
    org_id     TEXT NOT NULL,
    key        TEXT NOT NULL,
    old_value  JSONB,
    new_value  JSONB,
    changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_policy_history_org ON organization_policy_history (org_id, changed_at DESC);

COMMENT ON TABLE system_settings_history IS '시스템 설정 변경 이력 — 시크릿은 값 대신 *** (130)';
COMMENT ON TABLE organization_policy_history IS '조직 정책 변경 이력 — new_value NULL 은 삭제 (130)';
