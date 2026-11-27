-- Migration 212 — 조직 소유 확장 설치 (마켓플레이스 계획 v3.5 P8, opt-in EXTENSION_ORG_OWNED_INSTALL_ENABLED)
--
-- 2026-11-28. 종전 확장 소유권은 user_id 하나였다(166 의 조직 공개는 "보이기만"). 조직 소유 행은 소유자가 사람이 아니라
-- 조직이다 — 설치한 관리자가 조직을 떠나거나 계정이 삭제돼도 행이 남고, 수정·업데이트·제거는 그 조직의 관리자 누구나 한다.
--
-- 설계:
--   - 조직 소유 행은 user_id = NULL + owner_org_id = 조직. 사람 소유 행은 종전 그대로(user_id NOT NULL, owner_org_id NULL).
--     CHECK 로 "정확히 한쪽" 을 강제한다 — 사람 소유 행의 의미·제약은 바뀌지 않는다.
--     user_id 의 FK(ON DELETE CASCADE)는 그대로라 사람 소유 행은 종전처럼 계정과 함께 지워지고, 조직 소유 행은 user_id 가
--     없어 사용자 삭제의 연쇄 대상이 아니다. 설치자는 installed_by_user_id(ON DELETE SET NULL, 기록용 — 권한 근거 아님).
--   - 사람 소유 경로의 쿼리(`WHERE user_id = $n`)는 조직 소유 행에 절대 맞지 않는다 → 설치자가 개인 API 로 조직 소유 행을
--     지우거나 바꿀 수 없다(권한 판정은 security/authorize 'org_extension' 한 곳).
--   - 조직 공개 갤러리(listShared·getInstallableById)는 visibility='organization' AND org_id 조건 — 조직 소유 행은
--     visibility='organization', org_id = owner_org_id 로 저장해 같은 조건으로 함께 나온다(배포 모드 등 org_id 축 일관).
--   - 조직이 지워지면 조직 소유 행도 지운다(소유자 소멸 = 사람 소유 행의 CASCADE 와 같은 규칙).
--   - 이름 유일성: 조직 안에서 active 행 이름 1개(사람 소유의 (user_id, name) 와 같은 규칙).
--
-- 플래그 OFF 면 조직 소유 행은 만들어지지 않는다 — 기존 행·쿼리 결과는 그대로다.
-- 멱등 (ADD COLUMN IF NOT EXISTS · DROP/ADD CONSTRAINT · CREATE INDEX IF NOT EXISTS).

ALTER TABLE user_extensions ADD COLUMN IF NOT EXISTS owner_org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE user_extensions ADD COLUMN IF NOT EXISTS installed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE user_extensions ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE user_extensions DROP CONSTRAINT IF EXISTS user_extensions_owner_chk;
ALTER TABLE user_extensions ADD CONSTRAINT user_extensions_owner_chk
    CHECK ((user_id IS NOT NULL AND owner_org_id IS NULL) OR (user_id IS NULL AND owner_org_id IS NOT NULL));

-- 조직 소유 행은 그 조직에 공개된 상태로만 존재한다(갤러리 조건과 같은 축)
ALTER TABLE user_extensions DROP CONSTRAINT IF EXISTS user_extensions_org_owned_visibility_chk;
ALTER TABLE user_extensions ADD CONSTRAINT user_extensions_org_owned_visibility_chk
    CHECK (owner_org_id IS NULL OR (visibility = 'organization' AND org_id = owner_org_id));

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_extensions_org_owned_active_name
    ON user_extensions (owner_org_id, name) WHERE status = 'active' AND owner_org_id IS NOT NULL;

COMMENT ON COLUMN user_extensions.owner_org_id IS
    '조직 소유 설치(212, opt-in EXTENSION_ORG_OWNED_INSTALL_ENABLED)의 소유 조직. 이때 user_id 는 NULL — 설치자 탈퇴·계정 삭제와 무관하게 유지, 조직 삭제 시 함께 삭제';
COMMENT ON COLUMN user_extensions.installed_by_user_id IS
    '조직 소유 행을 처음 설치한 사용자(기록용 — 권한 근거 아님, 계정 삭제 시 NULL) (212)';
