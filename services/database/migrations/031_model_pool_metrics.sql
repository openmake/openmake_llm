-- Migration 031 — Model Pool routing 통계 영속화
--
-- LLMClient.chat() 의 capacity-based routing 결정 (PR #98) 을 DB 에 영속화.
-- admin dashboard 의 1주일 routing 비율 모니터링 + LLM_POOL_DEFAULT_MARGIN_PCT
-- 조정 의사결정 근거 제공.
--
-- 행 INSERT 빈도: 매 chat 호출 마다 1행 — 운영 부담 적음 (PR #92 의 alert_history
-- 와 동급 빈도). PII 없음 (input_tokens 수치만, content 제외).

CREATE TABLE IF NOT EXISTS model_pool_metrics (
    id          SERIAL PRIMARY KEY,
    model       TEXT NOT NULL,
    source      TEXT NOT NULL CHECK (source IN ('auto', 'auto_trimmed', 'auto_trimmed_reduced', 'manual', 'pool_disabled')),
    input_tokens     INTEGER,
    dropped_messages INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 주의: finish_reason='length' (truncation) 발생은 stream-parser.ts 의 logger.warn
-- + (future) alert_history 별도 책임. 본 테이블은 routing decision 만 추적.

CREATE INDEX IF NOT EXISTS idx_model_pool_metrics_created ON model_pool_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_pool_metrics_model ON model_pool_metrics(model);
CREATE INDEX IF NOT EXISTS idx_model_pool_metrics_source ON model_pool_metrics(source);
