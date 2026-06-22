-- 042_mcp_sandbox_network.sql
-- 외부 MCP stdio 서버 bwrap 샌드박스 네트워크 정책 컬럼.
--   'full' (기본): 네트워크 공유 — 외부 API 호출 서버·내부 DB 접속 서버.
--   'none' (--unshare-net): 네트워크 차단 — 임의 코드 실행 등 고위험 서버(예: Python REPL).
-- 멱등 작성. 운영 DB owner mismatch 대비 DO+EXCEPTION 으로 감쌈(graceful).

DO $$
BEGIN
    ALTER TABLE mcp_servers
        ADD COLUMN IF NOT EXISTS sandbox_network TEXT DEFAULT 'full';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'mcp_servers ALTER 권한 없음 — owner 로 수동 적용 필요 (graceful skip)';
    WHEN undefined_table THEN
        RAISE NOTICE 'mcp_servers 테이블 부재 — schema-initializer 가 생성 후 재적용 (graceful skip)';
END $$;

-- CHECK 제약 (재실행 안전 — 존재 시 skip)
DO $$
BEGIN
    ALTER TABLE mcp_servers
        ADD CONSTRAINT mcp_servers_sandbox_network_chk CHECK (sandbox_network IN ('full', 'none'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'mcp_servers CHECK 추가 권한 없음 (graceful skip)';
    WHEN undefined_table THEN NULL;
END $$;
