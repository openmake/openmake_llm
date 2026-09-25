-- 구 모델 배정 테이블 DROP (2026-09-25) — 170 이 세 테이블을 model_assignments 로 합친 뒤 v1.86.3 부터 읽기·쓰기 0건.
-- 2단계 삭제 규칙의 2단계. 옛 저장소(capability-models·user/global-model-roles repo)는 model_assignments 어댑터라 무관하다.
-- CASCADE 는 쓰지 않는다 — 의존 객체가 있으면 조용히 함께 지우지 말고 마이그레이션을 실패시킨다.
-- 되돌리기: migrations/rollbacks/171_drop_legacy_model_assignment_tables.sql (스키마 재생성 + model_assignments 역이관).

DROP TABLE IF EXISTS capability_models;
DROP TABLE IF EXISTS user_model_roles;
DROP TABLE IF EXISTS global_model_roles;
