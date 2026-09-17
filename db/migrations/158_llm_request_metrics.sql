-- 158: LLM 요청 셰도우 계측 (2026-09-17, F06.2 G0) — LLMClient·오케스트레이터 capability 호출 1건당 1행. 90일 보존
-- 모델별 TTFT·오류율로 품질·비용 라우팅 도입을 재판정하기 위한 데이터(라우팅 정책은 아직 없다)
CREATE TABLE IF NOT EXISTS llm_request_metrics (
    id                 BIGSERIAL PRIMARY KEY,
    model              TEXT NOT NULL,
    provider_id        TEXT NOT NULL,             -- 'local-llm' | 'external' | capability provider id
    request_class      TEXT NOT NULL,             -- interactive|agent_turn|fanout|background|unspecified
    user_id            TEXT,
    ttft_ms            INTEGER,
    total_ms           INTEGER NOT NULL,
    prompt_tokens      INTEGER,
    completion_tokens  INTEGER,
    finish_reason      TEXT,
    error_code         TEXT,
    cost_owner         TEXT,                      -- user|server|local
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_llm_req_metrics_created ON llm_request_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_req_metrics_model ON llm_request_metrics(model, created_at DESC);
