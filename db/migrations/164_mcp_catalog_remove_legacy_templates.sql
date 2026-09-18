-- ============================================================
-- 164_mcp_catalog_remove_legacy_templates.sql — 폐기한 카탈로그 템플릿 6개 제거 (2026-09-19)
-- ============================================================
-- 목적: 초기 시드(028 등)가 넣는 템플릿 중 운영에서 폐기한 6개를 신규 설치에서도 없앤다.
--       Add-on 전환으로 커넥터의 SoT 가 connectors-pack 의 mcp-catalog.json 이 됐는데(163), 구 마이그레이션은
--       신규 DB 에 여전히 이 6개를 넣어 "팩이 싣지 않는데 카탈로그에 보이는" 상태를 만든다.
--       6개 모두 운영 카탈로그에서 관리자가 이미 제거한 항목이고 connectors-pack 에도 없다. 기록으로 확인되는 사유:
--         mcp-postgres   연결 문자열(비밀값)을 CLI 인자로만 받는다 — ps 노출, env_schema secret 규약과 충돌
--         mcp-memory     그래프 메모리 도입 반대 판정(대화 간 메모리는 user_memories)
--         mcp-github     원격 OAuth 판 mcp-github-remote(153)가 있다
--       나머지 3개(mcp-brave-search · mcp-fetch · mcp-sequential-thinking)는 제거 사유 기록이 없다 — 운영 상태를 따른다.
--
-- 안전장치: 그 템플릿으로 설치한 사용자 서버(mcp_servers.catalog_template_id)가 있으면 지우지 않는다 —
--           설치본은 템플릿 스냅샷으로 동작하지만, 쓰는 사람이 있는 배포의 카탈로그를 말없이 바꾸지 않기 위함.
--           그런 배포는 관리자가 카탈로그 화면에서 직접 정리한다.
-- 멱등: 이미 없으면 0행 삭제. 운영 DB 는 관리자가 이미 지운 상태라 영향 없음.
-- 롤백: 없음 — 되살리려면 028 등 원 시드의 INSERT 를 다시 실행한다(rollbacks/164 참고).
-- ============================================================

DELETE FROM mcp_server_catalog c
WHERE c.id IN (
    'mcp-brave-search', 'mcp-fetch', 'mcp-github',
    'mcp-memory', 'mcp-postgres', 'mcp-sequential-thinking'
)
AND NOT EXISTS (SELECT 1 FROM mcp_servers s WHERE s.catalog_template_id = c.id);
