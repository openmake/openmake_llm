-- Migration 072 — user_agents.model (에이전트 정의 단위 모델 배정)
--
-- Role-based Orchestration 2차 Phase C (2026-07-15).
-- Custom Agent 가 자체 모델(fullId)을 가질 수 있다 (OpenCode 의 per-agent model 패턴).
-- NULL = 상속(요청 모델/기본 모델). 적용 규칙: 요청 model 이 자동('default'/빈값)일 때만
-- 에이전트 model 로 대체 — 사용자의 명시적 모델 선택이 항상 우선.
-- 외부 fullId 는 그 소유자의 BYOK 키(user_external_api_keys)로 실행된다.

ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS model TEXT;

COMMENT ON COLUMN user_agents.model IS
    '에이전트 전용 모델 fullId (NULL=상속). 요청 model 이 자동일 때만 적용, 외부 모델은 소유자 BYOK 키 필요.';
