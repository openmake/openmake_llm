-- 077: Agent Task Git 통합 (Phase 2b) — 태스크가 작업할 원격 repo/브랜치
--
-- 에이전트 작업이 원격 GitHub repo 를 대상으로 동작하도록 clone 정보를 보관한다.
-- 실행 시 호스트가 이 repo 를 workspace 에 clone(토큰은 external_connections github) →
-- 컨테이너(network none)에서 에이전트가 편집 → 기존 diff 캡처가 변경분 표시.
-- 멱등(ADD COLUMN IF NOT EXISTS). 수동 적용(cli.ts migrate).

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS git_repo_url TEXT;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS git_branch TEXT;

COMMENT ON COLUMN agent_tasks.git_repo_url IS 'Phase 2b: 작업 대상 GitHub repo URL (https://github.com/org/repo). 있으면 실행 시 호스트가 workspace 에 clone.';
COMMENT ON COLUMN agent_tasks.git_branch IS 'Phase 2b: clone 할 브랜치(base). 미지정 시 repo 기본 브랜치.';
