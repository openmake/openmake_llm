-- 044_mcp_sandbox_host_optout.sql
-- 외부 MCP 서버 per-server 샌드박스 opt-out 값 'host' 추가.
--   sandbox_network: 'full'(bridge) | 'none'(--network none) | 'host'(컨테이너 없이 호스트 직접 실행).
-- 'host' = 호스트 설치 바이너리(/Users·/Volumes 경로 등)에 의존해 generic 런타임 이미지에서
--   동작 불가한 신뢰 로컬 서버(open-design·Python REPL·noapi-google-search 등)를 비격리 실행.
-- 042 의 CHECK 제약을 'host' 포함으로 교체. 멱등 + graceful owner.

DO $$
BEGIN
    ALTER TABLE mcp_servers DROP CONSTRAINT IF EXISTS mcp_servers_sandbox_network_chk;
    ALTER TABLE mcp_servers
        ADD CONSTRAINT mcp_servers_sandbox_network_chk CHECK (sandbox_network IN ('full', 'none', 'host'));
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'mcp_servers CHECK 교체 권한 없음 — owner 로 수동 적용 필요 (graceful skip)';
    WHEN undefined_table THEN
        RAISE NOTICE 'mcp_servers 테이블 부재 (graceful skip)';
END $$;
