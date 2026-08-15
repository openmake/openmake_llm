-- Migration 094 — user_extensions.tracking_ref (Phase 2: 버전/업데이트 확인)
--
-- 2026-08-16. 설치 시 요청한 git ref(브랜치/태그/SHA)를 영속한다.
-- 기존에는 resolved SHA(source_ref)만 저장해 "무엇을 추적 중인지"를 잃었음 —
-- 업데이트 확인은 tracking_ref(NULL = 기본 브랜치 HEAD)를 다시 resolve 해
-- source_ref 와 비교한다. 고정 SHA 추적이면 항상 최신으로 판정(핀 고정).
--
-- 멱등 (ADD COLUMN IF NOT EXISTS).

ALTER TABLE user_extensions ADD COLUMN IF NOT EXISTS tracking_ref TEXT;

COMMENT ON COLUMN user_extensions.tracking_ref IS
    '설치 시 요청한 git ref (브랜치/태그/SHA). NULL = 기본 브랜치 HEAD 추적. 업데이트 확인의 비교 기준.';
