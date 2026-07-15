-- Migration 069 — user_model_roles 테이블
--
-- Role-based Multi-Agent Orchestration Phase 2 (2026-07-15).
-- 로그인 사용자가 자신이 등록한 모델(로컬 + BYOK 외부)을 역할별로 배정한다.
-- 해석 우선순위: 이 테이블(사용자 매핑) → OMK_<ROLE>_MODEL env(전역, 로컬만)
-- → LLM_DEFAULT_MODEL. USER_MODEL_ROLES_ENABLED 플래그로 게이트 (기본 OFF).
--
-- role CHECK 는 코드 SoT(config/model-roles.ts MODEL_ROLES)와 정합 유지할 것.
-- API 계층(user-model-roles.controller)은 이 중 사용자 배정 가능 role
-- (USER_ASSIGNABLE_MODEL_ROLES: agent/judge/research/spawn/review)만 허용한다.

CREATE TABLE IF NOT EXISTS user_model_roles (
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role           TEXT NOT NULL CHECK (role IN ('chat', 'agent', 'judge', 'research', 'spawn', 'review', 'router')),
    full_model_id  TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role)
);

COMMENT ON TABLE user_model_roles IS
    '사용자별 역할→모델 매핑 (Role-based Multi-Agent Orchestration). 외부 모델은 그 사용자의 user_external_api_keys BYOK 키로 호출.';
COMMENT ON COLUMN user_model_roles.role IS
    'LLM 호출 역할 — config/model-roles.ts MODEL_ROLES 와 정합. API 는 agent/judge/research/spawn/review 만 배정 허용.';
COMMENT ON COLUMN user_model_roles.full_model_id IS
    '모델 fullId — ''local-llm:<tag>'' | ''<external_provider>:<model>'' | 로컬 태그. 해석은 services/model-role-resolver.';
