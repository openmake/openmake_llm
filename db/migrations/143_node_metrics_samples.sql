-- 143: 노드 지표·큐 깊이 샘플 (2026-09-17, F24.4) — vLLM /metrics(선택: DCGM) 스크레이프 + 앱 큐 깊이, 60초 단위·14일 보존
CREATE TABLE IF NOT EXISTS node_metrics_samples (
    id          BIGSERIAL PRIMARY KEY,
    sampled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    node_id     TEXT NOT NULL,                 -- 스크레이프 대상 host:port 또는 'app'
    metric      TEXT NOT NULL,                 -- vllm_requests_waiting | vllm_kv_cache_pct | dcgm_gpu_util | queue_depth ...
    labels      JSONB,                         -- {queue:'agent_task_pending'} 등
    value       DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_node_metrics_samples_lookup ON node_metrics_samples (metric, node_id, sampled_at DESC);
CREATE INDEX IF NOT EXISTS idx_node_metrics_samples_sampled ON node_metrics_samples (sampled_at);
COMMENT ON TABLE node_metrics_samples IS 'vLLM/DCGM 스크레이프 + 큐 깊이 샘플(143) — 14일 보존';
