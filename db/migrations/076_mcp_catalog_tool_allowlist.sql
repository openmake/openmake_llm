-- ============================================================
-- 076_mcp_catalog_tool_allowlist.sql — 카탈로그 도구 화이트리스트 + NotebookLM 시드
-- ============================================================
-- 목적: 도구가 매우 많은 MCP 서버(NotebookLM 39개 등)가 채팅 자동 노출 cap(12)을
--       독식하거나, 핵심 도구가 서버 도구 순서(알파벳) 때문에 cap 밖으로 밀리는
--       문제를 해결한다. 카탈로그 템플릿에 채팅 노출 화이트리스트를 정의하면
--       spawn 시 config 로 전달돼 채팅 자동 노출(tool-merger)에서 이 목록만,
--       이 순서대로 노출된다.
--
-- 적용 범위: **채팅 자동 노출에만** 적용. REST 직접 실행(/api/mcp/tools/:name/execute)
--       과 도구 picker 명시 활성화는 전체 도구를 그대로 쓸 수 있다(파워유저 우회 보존).
--       NULL 이면 기존 동작(전체 노출) 유지.
--
-- 순서 의미: 배열 첫 도구가 round-robin 대표로 뽑힌다 — notebook_list 를 첫 번째로
--       두어 서버명을 언급하지 않은 메시지("내 노트북 목록")에서도 목록 조회가 가능.
--
-- 반영 시점: spawn 시 조회 — 이미 떠 있는 클라이언트는 다음 respawn/재시작부터 적용.
-- 멱등: ADD COLUMN IF NOT EXISTS + allowlist IS NULL 조건 UPDATE.
-- ============================================================

ALTER TABLE mcp_server_catalog ADD COLUMN IF NOT EXISTS tool_allowlist JSONB;

COMMENT ON COLUMN mcp_server_catalog.tool_allowlist IS
  '채팅 자동 노출 도구 화이트리스트(JSON array, 순서=노출 우선순위). NULL=전체 노출. REST 직접 실행에는 미적용';

UPDATE mcp_server_catalog
SET tool_allowlist = '["notebook_list","notebook_query","notebook_describe","source_add","research_start"]'::jsonb
WHERE id = 'mcp-notebooklm' AND tool_allowlist IS NULL;
