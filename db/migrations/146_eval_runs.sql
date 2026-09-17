-- 146: 평가 실행 이력 (2026-09-17, F26.1) — 모든 러너 공통(routing·response·tools·matrix), 매트릭스는 셀당 1행. 무기한 보존
CREATE TABLE IF NOT EXISTS eval_runs (
    id              BIGSERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ NOT NULL,
    runner          TEXT NOT NULL,            -- routing | response | tools | matrix
    mode            TEXT NOT NULL CHECK (mode IN ('mock', 'real')),
    dataset_version TEXT NOT NULL,
    git_hash        TEXT,
    model           TEXT,
    variant         TEXT,                     -- 매트릭스 variant 이름
    matrix_run_id   TEXT,                     -- 같은 매트릭스 실행의 셀 묶음
    total_cases     INTEGER NOT NULL,
    passed_cases    INTEGER NOT NULL,
    pass_rate       DOUBLE PRECISION NOT NULL,
    ttft_p50_ms     INTEGER,
    ttft_p95_ms     INTEGER,
    total_p50_ms    INTEGER,
    total_p95_ms    INTEGER,
    input_tokens    BIGINT,
    output_tokens   BIGINT,
    cost_usd_micros BIGINT NOT NULL DEFAULT 0,
    summary         JSONB NOT NULL            -- 실패 케이스 id·사유(케이스 결과 전체는 logs/ JSON)
);
CREATE INDEX IF NOT EXISTS idx_eval_runs_runner_time ON eval_runs (runner, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_runs_matrix ON eval_runs (matrix_run_id) WHERE matrix_run_id IS NOT NULL;
COMMENT ON TABLE eval_runs IS '평가 실행 이력(146) — evaluation/eval-run-recorder, SLO eval_pass(145)·/admin/evaluations 가 읽는다';
