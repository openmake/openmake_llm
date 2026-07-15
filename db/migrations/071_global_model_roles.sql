-- Migration 071 — global_model_roles (전역 역할→모델 매핑, Admin UI L3)
--
-- Role-based Orchestration 2차 Phase B (2026-07-15).
-- env(OMK_<ROLE>_MODEL, L1) 전역 매핑을 DB 로 승격 — 재시작 없이 운영자가 조정.
-- 해석 우선순위: user_model_roles → global_model_roles(이 테이블) → env → LLM_DEFAULT_MODEL.
-- 외부 fullId 는 서버 공용 키(server_external_api_keys, 070) 등록이 전제.
-- role CHECK 는 config/model-roles.ts MODEL_ROLES 와 정합 유지할 것.

CREATE TABLE IF NOT EXISTS global_model_roles (
    role           TEXT PRIMARY KEY CHECK (role IN ('chat', 'agent', 'judge', 'research', 'spawn', 'review', 'router')),
    full_model_id  TEXT NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE global_model_roles IS
    '전역 역할→모델 매핑 (Admin UI 관리, L3). resolver 는 60s 캐시로 조회 — 변경 후 최대 60초 내 반영.';
