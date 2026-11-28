-- Rollback 213 — 사용자별 한도 덮어쓰기 표 제거(플래그를 먼저 끌 것 — 켜진 채면 조회 실패는 전역 한도로 fail-open)
DROP TABLE IF EXISTS user_quota_overrides;
