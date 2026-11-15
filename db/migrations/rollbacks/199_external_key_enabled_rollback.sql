-- 199 되돌리기 — enabled 컬럼을 지운다.
-- 꺼 둔 키가 모두 다시 켜진다(컬럼이 없어지면 is_active = TRUE 인 키는 전부 쓰인다).
-- enabled 를 읽는 코드를 먼저 이전 버전으로 되돌린 뒤 실행한다.

ALTER TABLE user_external_api_keys DROP COLUMN IF EXISTS enabled;
