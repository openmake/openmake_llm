-- 200 되돌리기 — isolation 컬럼을 지운다.
-- 화면의 격리 상태 표시가 사라질 뿐 작업 실행에는 영향이 없다.
-- isolation 을 읽고 쓰는 코드를 먼저 이전 버전으로 되돌린 뒤 실행한다.

ALTER TABLE agent_tasks DROP COLUMN IF EXISTS isolation;
