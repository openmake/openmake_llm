-- 127: 조직·멤버·조직 토큰 예산 (로드맵 5단계 Control Plane 기초, 2026-09-16)
--
-- 멀티테넌시의 첫 조각. 소유권·격리는 여전히 user_id 기준이고(기존 동작 무변경), 조직은 **선택**
-- 구조다 — 멤버십이 없는 사용자에게는 아무 영향이 없다. 지금 조직이 하는 일은 하나: 월 토큰 예산을
-- 멤버 전체 사용량에 대해 강제한다(llm/user-quota). RBAC 는 owner/admin/member 세 역할.
CREATE TABLE IF NOT EXISTS organizations (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    slug                 TEXT NOT NULL UNIQUE,
    monthly_token_budget BIGINT,
    created_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS organization_members (
    org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_organization_members_user ON organization_members(user_id);

COMMENT ON TABLE organizations IS '조직(선택 구조) — monthly_token_budget 은 멤버 합산 월 토큰 예산, NULL=무제한 (127)';
COMMENT ON TABLE organization_members IS '조직 멤버십 — role owner|admin|member. 한 사용자가 여러 조직에 속할 수 있다 (127)';
