-- 173: 서브에이전트 대화 체크포인트 (2026-10-01)
-- delegate 서브에이전트는 부모 작업의 한 턴 안에서 자기 대화로 도는 루프라, 그 안에서 승인을 기다리면
-- 부모가 실행 슬롯을 쥔 채 멈춘다(승인 대기 유예 후 주차가 닿지 않던 경로). 유예를 넘기면 서브 대화를
-- 여기에 남기고 부모를 delegate 호출 지점에서 주차한다. 재개 때 같은 위임(ckpt_key)이 이 대화에서 이어간다.
-- 서브가 끝나면 행을 지운다 — 남아 있는 행은 "주차 중인 위임"뿐이다. 멱등.
CREATE TABLE IF NOT EXISTS agent_task_subagent_checkpoints (
    task_id      TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
    ckpt_key     TEXT NOT NULL,            -- 위임 식별: sha256(origin|role|subgoal)
    conversation JSONB NOT NULL,
    turn         INTEGER NOT NULL,
    tokens       INTEGER NOT NULL DEFAULT 0,
    trace_id     TEXT,                     -- 활동 기록(109)을 같은 trace 로 잇기 위한 값
    trace_seq    INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, ckpt_key)
);
COMMENT ON TABLE agent_task_subagent_checkpoints IS '승인 대기로 주차된 delegate 서브에이전트의 대화 — 재개 지점 (173)';
