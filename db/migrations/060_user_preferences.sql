-- 060: users.preferences JSONB — 앱 설정(모델·응답스타일·테마·알림·개인정보 토글) 영속화.
--
-- 배경: apps/web 설정 페이지가 custom_instructions 만 서버 저장하고 나머지(기본 모델,
--   응답 스타일, 테마, 이메일 알림, 대화기록 저장(saveHistory), 메모리 학습(memoryLearning))는
--   로컬/목업이라 새로고침 시 소실되고 개인정보 토글이 비기능이었다. 이를 서버 영속화한다.
--   개별 컬럼 대신 확장 가능한 JSONB 단일 컬럼으로 관리(스키마 변경 없이 키 추가 가능).
--
-- 멱등: IF NOT EXISTS. 기본값 빈 객체.

ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
