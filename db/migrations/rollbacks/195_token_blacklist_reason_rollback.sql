-- 195 되돌리기 — 블랙리스트 폐기 사유 열 제거. 블랙리스트 행(폐기 자체)은 그대로 남는다.
-- 코드만 이전 버전으로 되돌리는 롤백에는 이 파일이 필요 없다(이전 코드는 이 열을 읽지 않는다).
-- 새 코드가 도는 동안 이 파일만 적용하면 모델 ensureTable 이 다음 부팅 때 열을 다시 만든다.
ALTER TABLE token_blacklist DROP COLUMN IF EXISTS reason;
