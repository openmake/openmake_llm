-- 081: Agent Task 실행 백엔드 선택 (Cowork D1a)
--
-- 'sandbox'(서버 Docker, 현행 기본) | 'local'(데스크톱 브리지 경유 사용자 머신 실행).
-- local 은 LOCAL_EXECUTOR_ENABLED + 디바이스 연결 시에만 실행 가능(미연결이면 graceful degrade).
-- 멱등(ADD COLUMN IF NOT EXISTS). 부팅 자동 적용(runner).

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS executor TEXT NOT NULL DEFAULT 'sandbox';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agent_tasks_executor_check'
    ) THEN
        ALTER TABLE agent_tasks
            ADD CONSTRAINT agent_tasks_executor_check CHECK (executor IN ('sandbox', 'local'));
    END IF;
END $$;

COMMENT ON COLUMN agent_tasks.executor IS 'D1a: 실행 백엔드 — sandbox(서버 Docker) | local(로컬 브리지). 기본 sandbox.';
