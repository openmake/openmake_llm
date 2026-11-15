-- 199: 사용자 외부(BYOK) 키 켜고 끄기 — 지우지 않고 끄는 플래그
--
-- is_active 는 삭제 버튼이 FALSE 로 바꾸는 소프트 삭제 플래그다. enabled 는 그와 별개로
-- 사용자가 키를 남겨 둔 채 끄고 켜는 값이다. 꺼진 키는 조회 기본값에서 빠져 삭제한 키처럼 쓰이지 않는다.
--
-- 예외 블록을 두지 않는다 — 권한 부족을 NOTICE 로 삼키면 컬럼 없이 "적용됨" 으로 기록되어
-- 그 장비의 BYOK 조회가 전부 오류가 된다. 부팅 때 크게 실패하는 쪽이 낫다.

ALTER TABLE user_external_api_keys
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
