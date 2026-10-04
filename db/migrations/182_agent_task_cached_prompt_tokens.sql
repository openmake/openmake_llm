-- 182: 에이전트 작업의 캐시 적중(cached) 프롬프트 토큰 누적 — 관측용
--
-- 에이전트 작업은 턴마다 같은 시스템 프롬프트·도구 스키마·앞선 대화를 다시 보낸다. 모델 서버의
-- 프롬프트 캐시 적중률이 비용·지연을 좌우하는데, 지금까지는 total_tokens(066)만 남겼다.
--   cached_prompt_tokens          서버가 "캐시에서 읽었다"고 돌려준 입력 토큰의 합
--   cache_reported_prompt_tokens  그 값을 돌려준 호출의 입력 토큰 합(적중률의 분모)
-- 둘 다 NULL 이면 서버가 값을 준 적이 없다는 뜻이다(적중 0 과 구분). DEFAULT 를 두지 않는다.
-- 멱등(ADD COLUMN IF NOT EXISTS). 되돌리기: rollbacks/182_agent_task_cached_prompt_tokens_rollback.sql

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS cached_prompt_tokens INTEGER;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS cache_reported_prompt_tokens INTEGER;

COMMENT ON COLUMN agent_tasks.cached_prompt_tokens IS '캐시 적중 입력 토큰 누적 — NULL 은 모델 서버가 값을 주지 않음(적중 0 과 구분).';
COMMENT ON COLUMN agent_tasks.cache_reported_prompt_tokens IS '캐시 값을 돌려준 호출의 입력 토큰 누적 — 적중률의 분모.';
