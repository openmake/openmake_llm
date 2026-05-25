-- Migration 032 — users.custom_instructions 컬럼 추가
--
-- 사용자별 영구 system prompt 추가 지시문 (claude.ai / ChatGPT 의 Custom
-- Instructions 동등 기능). 매 chat 요청 시 backend 가 조회하여 system prompt
-- 에 prepend.
--
-- 도입 배경 (2026-05-26):
--   - 인-세션 verbosity 루프 (T1~T9 분석) 의 해결책 #2 — 사용자가 한 번 설정한
--     선호가 모든 세션·모든 모델 응답에 일관 적용.
--   - 예: "묻지 않은 정보 0개", "한 줄로 답할 수 있으면 한 줄로", "한국어로
--     응답" 등.
--
-- 길이 제한:
--   - 4000 chars (env CUSTOM_INSTRUCTIONS_MAX_CHARS override 가능)
--   - context window 보호 + 운영자 abuse 방지
--   - 애플리케이션 layer 에서 검증, DB 는 TEXT 허용
--
-- nullable / 기본 NULL — 미설정 시 backend 가 prepend 단계 스킵.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS custom_instructions TEXT;

COMMENT ON COLUMN users.custom_instructions IS
    '사용자별 영구 system prompt 추가 지시문. 매 chat 요청 시 backend 가 system prompt 앞에 prepend. NULL 또는 빈 문자열은 미적용.';
