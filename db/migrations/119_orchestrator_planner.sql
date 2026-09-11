-- Migration 119 — 'planner' 역할 + 멀티모달 오케스트레이터 셰도우 테이블
--
-- 멀티모달 오케스트레이터(2026-09-12, docs/proposals/2026-09-12-multimodal-orchestrator-design.md).
-- ① 역할 CHECK 확장: Planner(질문 분석 → capability 작업 계획 JSON) 모델을 역할 시스템으로 배정한다.
--    코드 SoT: config/model-roles.ts MODEL_ROLES (9종). 073 패턴.
-- ② orchestrator_runs: 매 턴 계획·실행을 적재하는 관측 전용 테이블 — "앞단 LLM 판단(A형)" 의 비용(계획 시간)과
--    채택률(simple 로 종전 경로로 간 비율, 작업 성공률)을 4주 후 재판정하는 근거.

ALTER TABLE user_model_roles DROP CONSTRAINT IF EXISTS user_model_roles_role_check;
ALTER TABLE user_model_roles ADD CONSTRAINT user_model_roles_role_check
    CHECK (role IN ('chat', 'agent', 'judge', 'research', 'spawn', 'review', 'router', 'summary', 'planner'));

ALTER TABLE global_model_roles DROP CONSTRAINT IF EXISTS global_model_roles_role_check;
ALTER TABLE global_model_roles ADD CONSTRAINT global_model_roles_role_check
    CHECK (role IN ('chat', 'agent', 'judge', 'research', 'spawn', 'review', 'router', 'summary', 'planner'));

CREATE TABLE IF NOT EXISTS orchestrator_runs (
    id              BIGSERIAL PRIMARY KEY,
    request_id      TEXT,
    user_id         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Planner
    planner_model   TEXT,
    planner_ms      INTEGER,
    planner_ok      BOOLEAN NOT NULL DEFAULT false,
    planner_error   TEXT,
    complexity      TEXT,                       -- simple | multi | (null = 실패)
    plan            JSONB,                      -- 검증 통과한 계획 원문
    -- 실행 (simple 이면 없음)
    task_count      INTEGER NOT NULL DEFAULT 0,
    tasks_ok        INTEGER NOT NULL DEFAULT 0,
    tasks_failed    INTEGER NOT NULL DEFAULT 0,
    tasks_pending   INTEGER NOT NULL DEFAULT 0,       -- 제출됐지만 미완료(영상 등)
    exec_ms         INTEGER,
    task_results    JSONB,                      -- [{id, capability, model, ms, ok, status, error, usage}] — usage 는 provider 가 준 값만(없으면 null)
    -- 결과 채택
    outcome         TEXT NOT NULL DEFAULT 'fallback'   -- executed | simple | fallback(계획 실패 → 종전 경로)
);

CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_created ON orchestrator_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orchestrator_runs_user ON orchestrator_runs (user_id, created_at DESC);

COMMENT ON TABLE orchestrator_runs IS
    '멀티모달 오케스트레이터 관측 전용(계획 시간·채택률·작업 성공률). 결과 채택엔 영향 없음.';

-- 비동기 작업(영상 생성 등) 재조회용 — 미완료 job 을 user/provider/job id 로 보존해 후속 턴이 새 제출 없이 같은 job 만 확인한다.
CREATE TABLE IF NOT EXISTS orchestrator_jobs (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL,
    capability    TEXT NOT NULL,
    provider_id   TEXT NOT NULL,
    job_id        TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',   -- pending | completed | failed
    result_path   TEXT,                              -- 완료 시 /generated/<file>
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, provider_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_orchestrator_jobs_user_pending ON orchestrator_jobs (user_id, status, created_at DESC);
