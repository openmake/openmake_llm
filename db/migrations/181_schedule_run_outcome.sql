-- 181: 예약 실행 결과를 예약에 반영하기 위한 칸.
-- last_failure_signature: 마지막 실행 실패의 오류 서명 — 같은 서명의 실패는 종료 알림을 다시 보내지 않는다.
-- disabled_reason: 연속 실패로 자동으로 꺼졌을 때의 사유. 다시 켜면 지운다.
-- 멱등: IF NOT EXISTS.
ALTER TABLE agent_task_schedules ADD COLUMN IF NOT EXISTS last_failure_signature TEXT;
ALTER TABLE agent_task_schedules ADD COLUMN IF NOT EXISTS disabled_reason TEXT;
