-- Migration 073 — 'summary' role 추가 (thinking 요약 헤드라인)
--
-- 클로드 웹식 생각 표시 (2026-07-15): 생각(thinking) 종료 시 별도 모델이
-- 한 줄 헤드라인을 생성한다. 그 요약 모델을 role 시스템으로 배정 가능하게
-- user_model_roles / global_model_roles 의 role CHECK 를 확장한다.
-- 코드 SoT: config/model-roles.ts MODEL_ROLES (8종으로 확장).

ALTER TABLE user_model_roles DROP CONSTRAINT IF EXISTS user_model_roles_role_check;
ALTER TABLE user_model_roles ADD CONSTRAINT user_model_roles_role_check
    CHECK (role IN ('chat', 'agent', 'judge', 'research', 'spawn', 'review', 'router', 'summary'));

ALTER TABLE global_model_roles DROP CONSTRAINT IF EXISTS global_model_roles_role_check;
ALTER TABLE global_model_roles ADD CONSTRAINT global_model_roles_role_check
    CHECK (role IN ('chat', 'agent', 'judge', 'research', 'spawn', 'review', 'router', 'summary'));
