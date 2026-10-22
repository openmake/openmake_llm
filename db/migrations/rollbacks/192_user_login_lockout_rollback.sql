-- 192 되돌리기 — 로그인 실패 카운터·잠금 시각 열 제거. 잠긴 계정은 즉시 풀린다(계정·비밀번호는 그대로).
-- 코드만 이전 버전으로 되돌리는 롤백에는 이 파일이 필요 없다(이전 코드는 이 열을 읽지 않는다).
ALTER TABLE users DROP COLUMN IF EXISTS locked_until;
ALTER TABLE users DROP COLUMN IF EXISTS failed_login_count;
