-- 129: 조직 정책 (F22 Phase C-1, 2026-09-17)
--
-- system_settings(092)의 조직 단위 부분집합. 허용 키·검증·병합 규칙은 config/org-policy-registry.ts 가 갖고,
-- 유효 정책은 services/org/effective-policy.ts 가 글로벌 ⊕ 조직으로 병합한다(deny 우선·allow 교집합·승인 하한 max).
-- 값은 JSONB (문자열 값도 JSON 문자열로 저장). 멱등.

CREATE TABLE IF NOT EXISTS organization_policies (
    org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    value      JSONB NOT NULL,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, key)
);
COMMENT ON TABLE organization_policies IS '조직 정책 — 허용 키는 config/org-policy-registry.ts, 유효값은 글로벌 설정과 병합 (129)';
