-- 097: oauth_states 에 client 컬럼 추가 (iOS 축 2 — 모바일 OAuth)
-- OAuth 시작 시 ?client=ios 를 state 에 귀속 → 콜백에서 웹(쿠키)/모바일(exchange code) 분기.
-- NULL = 웹 (기존 동작 무변경). 멱등 — 재실행 안전.
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS client TEXT;
