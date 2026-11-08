-- 197 되돌리기 — 관리자 bridge 허용 플래그 열 제거(허용 상태는 사라지고 모든 사용자 서버가 기본 egress 로 돌아간다).
-- 코드만 이전 버전으로 되돌리는 롤백에는 이 파일이 필요 없다(이전 코드는 이 열을 모른다).
ALTER TABLE mcp_servers DROP COLUMN IF EXISTS sandbox_bridge_allowed;
