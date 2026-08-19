-- Agent Task GitHub 연동 전면 폐기 (2026-08-19)
--
-- clone → 편집 → PR 생성 경로는 도입 후 실사용 0건(agent_tasks 226건 중 git_repo_url 사용 0,
-- PR 생성 0)이었고, 로컬 폴더 작업은 로컬 실행기(executor='local')가 담당한다. 코드 참조를
-- 모두 제거하고 컬럼·저장된 PAT 을 함께 회수한다(복원 경로를 남기지 않는 결정).
--
-- 선행: 077_agent_task_git_repo.sql / 078_agent_task_pr.sql 이 만든 컬럼.

ALTER TABLE agent_tasks DROP COLUMN IF EXISTS git_repo_url;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS git_branch;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS git_pr_url;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS git_pushed_branch;

-- 저장된 GitHub PAT — 유일한 소비자(services/github-token.ts)가 삭제되어 더는 읽히지 않는다.
-- 암호화된 토큰을 죽은 채로 남기지 않는다.
DELETE FROM external_connections WHERE service_type = 'github';
