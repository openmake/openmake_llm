-- Migration 190 — 설치형 확장의 권한 상태 (2026-10-16, 로드맵 작업 8 · 설계 D4·D8)
--
-- 설치형 확장(Git·ZIP·마켓 갤러리)은 번들의 openmake-addon.json permissions 로 권한을 "요청"한다.
-- 지금까지는 요청을 설치 순간에만 집행하고 승인 기록을 남기지 않아, 업데이트가 권한을 넓혀도 알 수 없었고
-- 매니페스트 없는 예전 확장(네트워크 묵시 허용)과 구분할 방법이 없었다. 이 마이그레이션은 상태와 승인 기록을 더한다.
--   reviewed          — permissions_granted 안에서 동작
--   legacy_unreviewed — 매니페스트·승인 기록이 없는 예전 설치(기본값). 종전 동작(네트워크 허용) 보존
--   review_required   — 업데이트가 승인 범위보다 넓게 요청. 초과분만 재승인 전까지 막는다
-- 판정: apps/api/src/services/extensions/permission-state.ts, 문서: docs/architecture/addon-platform.md §11.
--
-- additive 만 — 열 추가·CHECK 추가. 기존 열·표는 바꾸지 않는다. 멱등(IF NOT EXISTS + duplicate_object 가드 + 조건부 백필).
-- 코드만 되돌려도 동작한다(새 열은 기본값이 있고 이전 코드는 읽지 않는다).
-- 되돌리기(열 제거 — 승인 기록이 사라진다): rollbacks/190_user_extensions_permission_state_rollback.sql

ALTER TABLE user_extensions
    ADD COLUMN IF NOT EXISTS permission_state TEXT NOT NULL DEFAULT 'legacy_unreviewed',
    ADD COLUMN IF NOT EXISTS permissions_granted JSONB,
    ADD COLUMN IF NOT EXISTS permissions_requested JSONB,
    ADD COLUMN IF NOT EXISTS permissions_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS permissions_reviewed_by TEXT;

DO $$ BEGIN
    ALTER TABLE user_extensions ADD CONSTRAINT user_extensions_permission_state_chk
        CHECK (permission_state IN ('reviewed', 'legacy_unreviewed', 'review_required'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 백필: 설치 기록(manifest)에 번들이 요청한 권한 원문(addonPermissions 배열)이 있는 행은 그 권한으로 검토된 것으로 본다
-- (설치 당시 그 권한으로 deny-by-default 집행을 받았다). 2026-10-16 현재 이 키를 저장한 행은 없다 — 이 PR 의 ingest 가
-- 처음 저장한다. 그래서 지금 적용하면 모든 행이 legacy_unreviewed 로 남고, 되돌리기 뒤 다시 적용할 때는 이 키로 복원된다.
-- 이미 검토 기록이 있는 행은 건드리지 않는다(재적용 멱등).
UPDATE user_extensions
   SET permission_state = 'reviewed',
       permissions_granted = manifest->'addonPermissions',
       permissions_requested = manifest->'addonPermissions',
       permissions_reviewed_at = updated_at,
       permissions_reviewed_by = 'migration:190'
 WHERE permission_state = 'legacy_unreviewed'
   AND permissions_reviewed_at IS NULL
   AND jsonb_typeof(manifest->'addonPermissions') = 'array';

COMMENT ON COLUMN user_extensions.permission_state IS
    'reviewed | legacy_unreviewed(기본 — 매니페스트·승인 기록 없는 예전 설치, 종전 동작 보존) | review_required(업데이트가 승인 범위를 넘음 — 초과분만 차단) (190)';
COMMENT ON COLUMN user_extensions.permissions_granted IS
    '승인한 권한 배열(config/addon-permissions 어휘). legacy_unreviewed 는 NULL (190)';
COMMENT ON COLUMN user_extensions.permissions_requested IS
    '마지막 설치·업데이트 번들이 openmake-addon.json 으로 요청한 권한 배열. 매니페스트 미동봉이면 NULL (190)';
COMMENT ON COLUMN user_extensions.permissions_reviewed_at IS '마지막 승인·철회 시각 (190)';
COMMENT ON COLUMN user_extensions.permissions_reviewed_by IS '마지막으로 승인·철회한 사용자 id. 백필 행은 migration:190 (190)';
