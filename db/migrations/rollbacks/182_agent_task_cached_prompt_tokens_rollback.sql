-- 182 되돌리기: 캐시 적중 토큰 칸 제거.
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS cache_reported_prompt_tokens;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS cached_prompt_tokens;
