-- 136: 조직 월 비용 예산 (F25 PR-4, 2026-09-17)
-- 토큰 예산(127)과 독립인 USD micros 예산. 원장(cost_ledger) 기반 costq 버킷으로 검사한다. 사용자 월 비용 예산은 env USER_MONTHLY_COST_BUDGET_MICROS. 멱등.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS monthly_cost_budget_micros BIGINT;
COMMENT ON COLUMN organizations.monthly_cost_budget_micros IS '조직 월 비용 예산(USD micros, NULL=무제한) — 멤버 합산 원장 비용으로 강제 (136)';
