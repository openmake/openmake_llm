-- Migration 196 — 오케스트레이션 셰도우의 add-on 도구 의도 중립 열 (2026-11-05, PR-H1-1 외부 계약 단계적 전환)
--
-- discussion_intent(086)는 실제로 "add-on 기여 오케스트레이션 도구의 의도 프리필터 적중"이며 코드 필드 이름은 이미 addonToolIntent 다.
-- 열 이름을 바꾸면(RENAME) 코드만 되돌릴 때 구 코드의 INSERT·지표 SQL 이 깨지므로, 중립 열을 더하고 호환 기간 동안 같은 값을 이중 기록한다.
-- 코드: apps/api/src/services/chat-service/orchestration-shadow-recorder.ts(이중 기록),
--       apps/api/src/data/repositories/routing-metrics-repository.ts(두 열 OR 로 집계)
--
-- additive 만 — 열 추가 + 기존 행 backfill. 멱등(IF NOT EXISTS, 이미 맞춘 행은 건너뜀). 트랜잭션은 runner 가 감싼다.
-- 이후 단계: 코드 참조 제거 = PR-H1-4(이 backfill 문을 멱등 재실행), DROP COLUMN discussion_intent = PR-H1-5(다음 배포).
-- 되돌리기: rollbacks/196_orchestration_addon_tool_intent_rollback.sql

ALTER TABLE orchestration_dispatch_decisions
    ADD COLUMN IF NOT EXISTS addon_tool_intent BOOLEAN NOT NULL DEFAULT false;

UPDATE orchestration_dispatch_decisions
   SET addon_tool_intent = true
 WHERE discussion_intent AND NOT addon_tool_intent;

COMMENT ON COLUMN orchestration_dispatch_decisions.addon_tool_intent IS
    'add-on 기여 오케스트레이션 도구의 의도 프리필터 적중 — discussion_intent(086)의 중립 이름. 호환 기간 이중 기록.';
