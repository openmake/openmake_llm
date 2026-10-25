-- 194 되돌리기 — 토큰 무효화 기준 시각 열 제거. 무효화됐던 토큰이 만료 전이면 다시 통과한다(계정·비밀번호는 그대로).
-- 코드만 이전 버전으로 되돌리는 롤백에는 이 파일이 필요 없다(이전 코드는 이 열을 읽지 않는다).
ALTER TABLE users DROP COLUMN IF EXISTS tokens_valid_after;
