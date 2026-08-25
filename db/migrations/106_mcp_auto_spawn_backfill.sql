-- Migration 106 — draft 승인으로 들어온 사용자 MCP 서버의 auto_spawn 백필 (2026-08-26)
--
-- draft 경로(확장 설치·git ingest·수동 draft)는 `auto_spawn=FALSE` 로 INSERT 하고 승인 시
-- enabled 만 켰다. lifecycle-supervisor 는 로그인/채팅 시작 때 auto_spawn=TRUE 만 spawn 하므로
-- 이 서버들은 재시작 뒤 아무도 띄우지 않아 실패도 아닌 채 "연결 끊김"으로 남았다
-- (운영 실측: 사용자 서버 18개 중 5개). 승인 코드는 auto_spawn=TRUE 로 고쳤고, 여기서는
-- 이미 승인된 행을 같은 상태로 맞춘다.
--
-- 범위: 사용자 소유(user_id NOT NULL) + 승인 완료(status='active') + 카탈로그 미유래
-- (catalog_template_id IS NULL — 카탈로그 설치는 auto_spawn 을 사용자가 고를 수 있어
-- FALSE 가 의사표시일 수 있다). enabled 는 건드리지 않는다(사용 안 함은 그대로 제외).
-- 멱등: 조건에 맞는 행이 없으면 no-op.

UPDATE mcp_servers
   SET auto_spawn = TRUE,
       updated_at = NOW()
 WHERE user_id IS NOT NULL
   AND status = 'active'
   AND catalog_template_id IS NULL
   AND auto_spawn = FALSE;
