-- 124: Agent Task 런타임 내구성 — 승인 대기 영속 · 상태 전이 이벤트 · 도구 호출 저널 (2026-09-16)
--
-- 배경(로드맵 "Durable Task Runtime" 대조, 2026-09-15 실측):
--  * 승인 대기는 프로세스 메모리 Map 에만 있어 재시작하면 사라졌다 — paused 작업은 failed('server
--    restarted') 로 마킹된 뒤 checkpoint 로 재개되지만 승인은 처음부터 다시 요청됐고, 프로세스가
--    내려간 동안엔 승인함에 아무것도 보이지 않았다.
--  * 상태는 약 10곳에서 조건 없이 UPDATE 됐고 전이 기록이 없어 "언제 왜 paused→failed 가 됐는지"
--    를 사후에 알 수 없었다(agent_task_steps 는 재실행 시 지워진다).
--  * tool_result 스텝에 tool_call_id 가 없어 턴 중간 재개 때 이미 실행된 호출과 남은 호출을
--    구분할 수 없었다(AgentTaskService 의 "모든 도구가 idempotent-read" 주석은 bash·파일 쓰기
--    도구가 생긴 뒤로 사실이 아니다).
--
-- 기존 행·기존 동작 무영향(전부 NULL/기본값 허용, 테이블은 신규).

-- 1) 승인 대기 영속 — 요청 시 pending 행, 결정/만료 시 갱신. 재개된 작업이 같은 호출
--    (task_id + tool_name + args_hash)을 다시 요청하면 미소비 결정을 이어받는다(consumed_at).
CREATE TABLE IF NOT EXISTS agent_task_approvals (
    approval_id   TEXT PRIMARY KEY,
    task_id       TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL,
    tool_name     TEXT NOT NULL,
    args          JSONB,
    args_hash     TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'aborted')),
    answer_text   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL,
    decided_at    TIMESTAMPTZ,
    consumed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_task_approvals_user_pending
    ON agent_task_approvals(user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_agent_task_approvals_task_key
    ON agent_task_approvals(task_id, tool_name, args_hash);

-- 2) 상태 전이 이벤트 — AgentTaskRepository.updateAgentTask 가 status 를 바꿀 때마다 1행.
CREATE TABLE IF NOT EXISTS agent_task_events (
    id          BIGSERIAL PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_task_events_task ON agent_task_events(task_id, id);

-- 3) 도구 호출 저널 — tool_result 스텝이 어느 tool_call 의 결과인지. 재개 시 이 값이 있는
--    호출은 재실행하지 않고 결과를 재사용한다.
ALTER TABLE agent_task_steps ADD COLUMN IF NOT EXISTS tool_call_id TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_task_steps_tool_call
    ON agent_task_steps(task_id, tool_call_id) WHERE tool_call_id IS NOT NULL;

-- 4) "나머지 모두 승인" 플래그 영속 — 종전엔 메모리에만 있어 재시작 후 재개된 작업이 승인을
--    다시 물었다.
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS auto_approve BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON TABLE agent_task_approvals IS
    'HITL 승인 대기 영속 — pending 은 승인함 조회·재시작 후 이어받기, 결정은 재개된 작업이 소비(124)';
COMMENT ON TABLE agent_task_events IS
    'agent_tasks.status 전이 기록 — from/to/reason. 스텝과 달리 재실행 시 지워지지 않는다(124)';
COMMENT ON COLUMN agent_task_steps.tool_call_id IS
    'tool_result 스텝의 원 tool_call id — 턴 중간 재개 시 실행된 호출 판별(도구 호출 저널, 124)';
