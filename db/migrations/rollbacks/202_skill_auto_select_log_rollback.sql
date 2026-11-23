-- 202 되돌리기 — 측정 로그 테이블만 지운다. 기록 코드는 실패를 삼키므로(fail-open) 채팅에는 영향이 없다.

DROP TABLE IF EXISTS skill_auto_select_log;
