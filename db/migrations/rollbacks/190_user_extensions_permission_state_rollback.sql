-- 190 되돌리기 — 권한 상태 열 제거. ⚠️ 승인·철회 기록(누가·언제·무엇을)이 함께 사라진다.
-- 코드만 이전 버전으로 되돌리는 롤백에는 이 파일이 필요 없다(새 열은 기본값이 있어 이전 코드가 무시한다).
ALTER TABLE user_extensions DROP CONSTRAINT IF EXISTS user_extensions_permission_state_chk;
ALTER TABLE user_extensions
    DROP COLUMN IF EXISTS permission_state,
    DROP COLUMN IF EXISTS permissions_granted,
    DROP COLUMN IF EXISTS permissions_requested,
    DROP COLUMN IF EXISTS permissions_reviewed_at,
    DROP COLUMN IF EXISTS permissions_reviewed_by;
