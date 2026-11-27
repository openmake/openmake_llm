-- 209: 조직 공개 확장의 항목별 배포 모드 + 그룹별 덮어쓰기 + 멤버 설치 기록 (계획 v3.7 §8-1)
--
-- 조직 공개(166)는 "조직 멤버 갤러리에 보인다"까지만 한다. 이 표들은 그 위에 얹는 배포 단계다:
--   default_off  갤러리에만(종전과 같다 — 행이 없으면 이 값)
--   default_on   멤버에게 자동 설치, 멤버가 지우면 다시 설치하지 않는다(user_removed 기록)
--   required     자동 설치, 일반 멤버는 지울 수 없다(조직 owner/admin·시스템 admin 은 가능 — 모드가 required 로 남으면 다시 설치된다)
-- 해석 규칙(그룹 덮어쓰기 > 항목 기본값, 여러 그룹이면 가장 강한 값)은 config/extension-org-deployment.ts 한 곳이다.
-- 플래그 EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED 가 꺼져 있으면 아무도 이 표를 읽거나 쓰지 않는다.
--
-- 멤버 설치 기록(extension_org_member_installs)은 조정(reconcile)의 멱등·동시성 장치다 — (원본, 멤버) 당 한 행이고
-- 설치는 그 행을 조건부로 'installing' 으로 잡은(claim) 쪽 하나만 한다. 설치 자체는 갤러리 설치와 같은 엔진(ingest)이라
-- 스킬·MCP 서버는 멤버 소유 draft 로 들어와 각자 승인을 받는다(승인 우회 없음).
-- 멱등(IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS extension_org_deployments (
    extension_id TEXT NOT NULL REFERENCES user_extensions(id) ON DELETE CASCADE,
    org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    mode         TEXT NOT NULL DEFAULT 'default_off'
                 CHECK (mode IN ('default_off', 'default_on', 'required')),
    updated_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (extension_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_extension_org_deployments_org ON extension_org_deployments(org_id);

CREATE TABLE IF NOT EXISTS extension_org_group_modes (
    extension_id TEXT NOT NULL REFERENCES user_extensions(id) ON DELETE CASCADE,
    group_id     TEXT NOT NULL REFERENCES organization_groups(id) ON DELETE CASCADE,
    mode         TEXT NOT NULL CHECK (mode IN ('default_off', 'default_on', 'required')),
    updated_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (extension_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_extension_org_group_modes_group ON extension_org_group_modes(group_id);

CREATE TABLE IF NOT EXISTS extension_org_member_installs (
    source_extension_id    TEXT NOT NULL REFERENCES user_extensions(id) ON DELETE CASCADE,
    user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id                 TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    installed_extension_id TEXT REFERENCES user_extensions(id) ON DELETE SET NULL,
    state                  TEXT NOT NULL CHECK (state IN ('installing', 'installed', 'user_removed', 'failed')),
    attempts               INTEGER NOT NULL DEFAULT 0,
    last_error             TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_extension_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_extension_org_member_installs_installed
    ON extension_org_member_installs(installed_extension_id) WHERE installed_extension_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_extension_org_member_installs_user ON extension_org_member_installs(user_id);

COMMENT ON TABLE extension_org_deployments IS '조직 공개 확장의 항목별 배포 모드 default_off|default_on|required — 행 없음 = default_off (209)';
COMMENT ON TABLE extension_org_group_modes IS '그룹별 배포 모드 덮어쓰기 — 항목 기본값보다 우선, 여러 그룹이면 가장 강한 값 (209)';
COMMENT ON TABLE extension_org_member_installs IS '배포 모드 조정의 멤버별 설치 기록 — claim 으로 한 번만 설치, user_removed 면 default_on 재설치 안 함 (209)';
