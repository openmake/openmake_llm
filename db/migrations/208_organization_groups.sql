-- 208: 조직 내 그룹 (마켓플레이스 남은 개발계획 v3.7 §8-1 — 그룹별 배포 기본값 덮어쓰기의 대상)
--
-- 조직(127) 안의 최소 그룹: 그룹 표 + 그룹 멤버십. 편집은 조직 owner/admin(또는 시스템 admin)만 한다
-- (config/resource-policy 'org_extension_deployment'). 지금 그룹을 읽는 곳은 확장 배포 모드(209) 하나뿐이고,
-- 플래그 EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED 가 꺼져 있으면 아무도 읽지 않는다(표가 비어 있어도 종전 동작).
--
-- 그룹 멤버는 반드시 그 조직의 멤버다 — (org_id, user_id) 가 organization_members 를 참조하므로 조직에서
-- 빠지면 그룹 멤버십도 CASCADE 로 사라진다. 그룹과 멤버십의 org_id 일치는 (id, org_id) 복합 FK 가 강제한다.
-- 멱등(IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS organization_groups (
    id         TEXT PRIMARY KEY,
    org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT organization_groups_org_name_key UNIQUE (org_id, name),
    CONSTRAINT organization_groups_id_org_key UNIQUE (id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_organization_groups_org ON organization_groups(org_id);

CREATE TABLE IF NOT EXISTS organization_group_members (
    group_id   TEXT NOT NULL,
    org_id     TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT organization_group_members_group_fk FOREIGN KEY (group_id, org_id)
        REFERENCES organization_groups(id, org_id) ON DELETE CASCADE,
    CONSTRAINT organization_group_members_member_fk FOREIGN KEY (org_id, user_id)
        REFERENCES organization_members(org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_organization_group_members_user ON organization_group_members(user_id, org_id);

COMMENT ON TABLE organization_groups IS '조직 내 그룹 — 확장 배포 모드 그룹 덮어쓰기(209)의 대상. 편집은 조직 owner/admin (208)';
COMMENT ON TABLE organization_group_members IS '그룹 멤버십 — 조직 멤버만(복합 FK), 조직 탈퇴 시 CASCADE (208)';
