-- Migration 109 — 서브에이전트 활동 기록 (2026-08-26)
--
-- delegate / spawn_agents 로 만들어진 서브에이전트는 부모 작업의 한 턴 안에서 도는 프로세스 내
-- 루프라 agent_task_steps 에 아무것도 남지 않았다(fan-out 이 스텝 1개로 뭉쳐 보이고, 서브가 뭘
-- 검색했는지·어디서 실패했는지는 로그에만). 역대 유일한 spawn 실패(2026-08-02)가 원인 추적
-- 불가였던 이유이자, 2026-08-26 "도구 0개로 답 날조" 결함이 오래 안 보였던 이유다.
--
-- 별도 테이블인 이유: agent_task_steps 는 (task_id, step_number) UNIQUE 로 부모 루프가 번호를
-- 순차 배정한다. 서브는 부모 턴 도중에 여러 개가 동시에 돌므로 그 번호 공간에 끼워 넣을 수 없다.
-- trace_id = 위임/fan-out 1회, sub_index = fan-out 안의 몇 번째 서브, seq = 서브 안 순서.
--
-- 멱등 (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS agent_task_subagent_steps (
    id          BIGSERIAL PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
    trace_id    TEXT NOT NULL,
    origin      TEXT NOT NULL,            -- 'spawn_agents' | 'delegate'
    sub_index   INTEGER NOT NULL DEFAULT 0,
    label       TEXT,                     -- role / 페르소나 요약
    seq         INTEGER NOT NULL,
    step_type   TEXT NOT NULL,            -- 'tool_call' | 'tool_result' | 'final' | 'error'
    tool_name   TEXT,
    content     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_subagent_steps_task
    ON agent_task_subagent_steps (task_id, created_at);
