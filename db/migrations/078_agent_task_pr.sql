-- 078: Agent Task Git PR (Phase 2c) — 완료된 코드 작업의 PR 결과
--
-- Git 태스크(077 repo)가 완료되면 호스트가 변경분을 새 브랜치로 push 하고 PR 을 생성한다.
-- 생성된 PR URL·브랜치명을 보관해 채팅 카드/상세에서 "PR 보기" 링크로 노출한다.
-- 멱등(ADD COLUMN IF NOT EXISTS). 수동 적용(cli.ts migrate).

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS git_pr_url TEXT;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS git_pushed_branch TEXT;

COMMENT ON COLUMN agent_tasks.git_pr_url IS 'Phase 2c: 완료 시 생성된 Pull Request URL(있으면 카드에 링크).';
COMMENT ON COLUMN agent_tasks.git_pushed_branch IS 'Phase 2c: push 된 작업 브랜치명(openmake/task-<id>).';
