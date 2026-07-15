-- Migration 070 — 서버 공용 외부 키 + 서버 키 사용량
--
-- Role-based Orchestration 2차 Phase A (2026-07-15).
-- 운영자가 서버 레벨 외부 provider 키를 등록해 "전역 role 매핑"에 외부 모델을
-- 배정할 수 있게 한다 (사용자별 매핑·채팅 명시 선택은 계속 BYOK 전용 — 과금 통제).
-- 상한(daily_token_limit)은 등록 시 필수 — 무제한 운영자 과금 방지.

CREATE TABLE IF NOT EXISTS server_external_api_keys (
    provider_id          TEXT PRIMARY KEY,
    encrypted_key        TEXT NOT NULL,          -- token-crypto v1:iv:ct:tag (AES-256-GCM)
    base_url             TEXT,                   -- NULL 이면 카탈로그 defaultBaseUrl
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    daily_token_limit    BIGINT NOT NULL,        -- 필수 상한 (0 = 사용 불가로 해석)
    monthly_token_limit  BIGINT,                 -- NULL = 월 상한 없음 (일 상한만)
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE server_external_api_keys IS
    '서버 공용(운영자 소유) 외부 LLM provider 키 — 전역 role 매핑 전용. 사용자별 매핑/채팅은 BYOK 만 사용.';
COMMENT ON COLUMN server_external_api_keys.daily_token_limit IS
    '일 토큰 상한 (필수). 초과 시 role 해석이 로컬 default 로 fail-open 강등.';

-- 서버 키 호출별 사용량 — external_provider_usage(사용자 BYOK 과금 뷰)와 분리.
-- (사용자 테이블 FK 없음: 호출자는 참고용 텍스트 — 비용 주체는 운영자)
CREATE TABLE IF NOT EXISTS server_external_key_usage (
    id             BIGSERIAL PRIMARY KEY,
    provider_id    TEXT NOT NULL,
    model_id       TEXT NOT NULL,
    role           TEXT,                        -- 해석된 ModelRole (관측용)
    caller_user_id TEXT,                        -- 호출 사용자 (참고용, FK 없음)
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    input_tokens   INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_server_key_usage_provider_date
    ON server_external_key_usage (provider_id, occurred_at DESC);

COMMENT ON TABLE server_external_key_usage IS
    '서버 공용 키 호출별 사용량 — 운영자 비용 관측. 사용자 BYOK 사용량(external_provider_usage)과 분리.';
