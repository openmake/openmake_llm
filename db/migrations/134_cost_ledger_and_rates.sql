-- 134: 비용 원장·단가표 (F25 비용·쿼터 PR-1, 2026-09-17)
--
-- 회계 단위를 "로컬 토큰" 에서 "USD micros 원장" 으로 넓힌다. 원장은 append-only 단일 진실이고
-- KV 쿼터 버킷은 파생 카운터다(후속 PR 이 정산 잡으로 교정). 단가는 L3 DB(cost_rates) 가 우선이고
-- 없으면 코드/env 폴백(config/external-pricing.ts 상수표, LOCAL_LLM_COST_*). kind·unit 은 config/cost-kinds.ts.
-- 멱등.

CREATE TABLE IF NOT EXISTS cost_rates (
    kind                TEXT NOT NULL,          -- config/cost-kinds.ts 키 (llm.local, llm.external, media.image.generate, ...)
    rate_key            TEXT NOT NULL,          -- 모델 fullId · provider · '*' (kind 내 폴백)
    unit                TEXT NOT NULL,          -- token_in | token_out | token_think | call | image | second | char | gb_day
    usd_micros_per_unit NUMERIC(20,6) NOT NULL CHECK (usd_micros_per_unit >= 0),
    note                TEXT,
    updated_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind, rate_key, unit)
);

CREATE TABLE IF NOT EXISTS cost_ledger (
    id                  BIGSERIAL PRIMARY KEY,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id             TEXT,                   -- FK 없음: 삭제 사용자의 명세 보존(참조 제거는 UserManager.deleteUser 에서 익명화)
    org_id              TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    kind                TEXT NOT NULL,
    rate_key            TEXT NOT NULL,
    unit                TEXT NOT NULL,
    quantity            NUMERIC(20,6) NOT NULL CHECK (quantity >= 0),
    usd_micros_per_unit NUMERIC(20,6) NOT NULL,
    cost_usd_micros     BIGINT NOT NULL,
    cost_owner          TEXT NOT NULL CHECK (cost_owner IN ('user', 'server', 'byok')),
    agent_id            TEXT,
    session_id          TEXT,
    request_id          TEXT,
    feature             TEXT,                   -- chat | orchestrator | agent_task | research | role | ...
    meta                JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key     TEXT UNIQUE             -- 스냅샷·재시도 중복 방지 (NULL 허용)
);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_user_time ON cost_ledger (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_org_time  ON cost_ledger (org_id, occurred_at DESC) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cost_ledger_kind_time ON cost_ledger (kind, occurred_at DESC);

COMMENT ON TABLE cost_rates  IS '단가표(L3) — kind×rate_key×unit 당 USD micros. rate_key ''*'' 는 kind 폴백 (134)';
COMMENT ON TABLE cost_ledger IS '비용 원장(append-only, USD micros). KV 쿼터 버킷은 파생 카운터 (134)';
