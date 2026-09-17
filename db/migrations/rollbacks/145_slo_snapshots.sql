-- 145 롤백 — SLO tick 은 테이블이 없으면 적재만 실패(fail-open)
DROP TABLE IF EXISTS slo_snapshots;
