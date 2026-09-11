-- Migration 120 — modality_models DROP (2단계 배포의 2단계)
--
-- 117 이 만든 모달리티 배정 테이블은 118 이 capability_models 로 행을 이관했고,
-- v1.59.0(PR #837) 이 코드 참조를 전부 제거해 배포됐다(마지막 참조 UserManager.deleteUser 도 이 PR 에서 제거).
-- 되돌리려면 rollbacks/120_drop_modality_models.sql (capability_models 에서 역이관).
DROP TABLE IF EXISTS modality_models;
