-- 165 롤백 — 코드 참조 제거 배포 후에만 실행할 것(컬럼/테이블 삭제는 2단계).
DROP INDEX IF EXISTS idx_agent_skills_addon_id;
ALTER TABLE agent_skills DROP COLUMN IF EXISTS addon_id;
DROP INDEX IF EXISTS idx_addon_installations_state;
DROP TABLE IF EXISTS addon_installations;
