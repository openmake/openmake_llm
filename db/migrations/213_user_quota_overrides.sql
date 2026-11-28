-- Migration 213 — 사용자별 쿼터 한도 덮어쓰기 (F25 잔여, opt-in QUOTA_USER_OVERRIDES_ENABLED)
--
-- 2026-11-28. 종전엔 모든 사용자가 전역 LLM_HOURLY/WEEKLY_TOKEN_LIMIT·USER_MONTHLY_COST_BUDGET_MICROS 하나를 썼다.
-- 수동 grant(135, kind manual)는 특정 버킷에 한 번 더해 줄 뿐이라 "이 사용자는 계속 다른 한도" 를 표현하지 못했다.
--
-- 값 의미(칸마다 독립): NULL = 전역 값을 따른다 · 0 = 무제한 · 양수 = 그 사용자의 한도.
-- 행이 없으면 전 칸 NULL 과 같다. 플래그가 꺼져 있으면 이 표는 읽히지 않는다(종전 동작).
CREATE TABLE IF NOT EXISTS user_quota_overrides (
    user_id                     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    hourly_token_limit          BIGINT CHECK (hourly_token_limit IS NULL OR hourly_token_limit >= 0),
    weekly_token_limit          BIGINT CHECK (weekly_token_limit IS NULL OR weekly_token_limit >= 0),
    monthly_cost_budget_micros  BIGINT CHECK (monthly_cost_budget_micros IS NULL OR monthly_cost_budget_micros >= 0),
    reason                      TEXT,
    updated_by                  TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
