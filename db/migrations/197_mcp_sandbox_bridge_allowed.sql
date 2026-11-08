-- 197_mcp_sandbox_bridge_allowed.sql
-- 관리자가 특정 사용자 소유 stdio 서버에 bridge 네트워크를 허용하는 플래그(기본 false = egress 프록시 경유).
-- 관리자 bridge 허용 옵션(2026-11-08 점검 후속). 바꾼 사람·시각은 보안 감사 로그(mcp_server.sandbox_bridge_changed)가 기록한다.
-- 멱등 + graceful owner (044 와 같은 방식).

DO $$
BEGIN
    ALTER TABLE mcp_servers
        ADD COLUMN IF NOT EXISTS sandbox_bridge_allowed BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'mcp_servers ALTER 권한 없음 — owner 로 수동 적용 필요 (graceful skip)';
    WHEN undefined_table THEN
        RAISE NOTICE 'mcp_servers 테이블 부재 (graceful skip)';
END $$;
