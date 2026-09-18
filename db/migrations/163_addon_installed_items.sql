-- ============================================================
-- 163_addon_installed_items.sql — Add-on Host 설치 이력 (Add-on 전환, 2026-09-19)
-- ============================================================
-- 목적: 내장 add-on 이 싣는 항목(지금은 MCP 카탈로그 템플릿)을 부팅 시 설치할 때 "이미 한 번 설치한 항목" 을
--       기록한다. 설치기는 이력에 없는 항목만 넣는다 — 관리자가 카탈로그에서 지운 템플릿을 다음 부팅이
--       되살리지 않게 하기 위함이다(운영 DB 는 마이그레이션 정본 28개 중 6개를 삭제한 상태였다).
--       단순 ON CONFLICT DO NOTHING 은 삭제된 행을 다시 넣는다.
--
-- 백필: 이 시점에 팩이 싣는 22개 템플릿은 모두 과거 마이그레이션(028~162)이 시드한 것이라 "설치됨" 으로
--       기록한다. 기존 배포는 아무것도 다시 설치되지 않고, 신규 배포는 마이그레이션 시드 → 이 백필 순서라
--       결과가 같다. 앞으로 추가되는 커넥터는 마이그레이션이 아니라 팩의 mcp-catalog.json 으로 들어온다.
-- 멱등: CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING.
-- ============================================================

CREATE TABLE IF NOT EXISTS addon_installed_items (
    kind         TEXT NOT NULL,                 -- 'mcp-catalog'
    item_id      TEXT NOT NULL,                 -- 항목 id (mcp_server_catalog.id)
    addon_id     TEXT NOT NULL,                 -- 항목을 실은 add-on
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind, item_id)
);

INSERT INTO addon_installed_items (addon_id, kind, item_id) VALUES
    ('kakao-map', 'mcp-catalog', 'mcp-kakao'),
    ('notebooklm', 'mcp-catalog', 'mcp-notebooklm'),
    ('connectors-pack', 'mcp-catalog', 'mcp-atlassian-remote'),
    ('connectors-pack', 'mcp-catalog', 'mcp-circleci'),
    ('connectors-pack', 'mcp-catalog', 'mcp-context7'),
    ('connectors-pack', 'mcp-catalog', 'mcp-datago-fsc'),
    ('connectors-pack', 'mcp-catalog', 'mcp-datago-nps'),
    ('connectors-pack', 'mcp-catalog', 'mcp-datago-nts'),
    ('connectors-pack', 'mcp-catalog', 'mcp-datago-pps'),
    ('connectors-pack', 'mcp-catalog', 'mcp-filesystem'),
    ('connectors-pack', 'mcp-catalog', 'mcp-github-remote'),
    ('connectors-pack', 'mcp-catalog', 'mcp-google-calendar-remote'),
    ('connectors-pack', 'mcp-catalog', 'mcp-google-drive-remote'),
    ('connectors-pack', 'mcp-catalog', 'mcp-google-gmail-remote'),
    ('connectors-pack', 'mcp-catalog', 'mcp-hubspot'),
    ('connectors-pack', 'mcp-catalog', 'mcp-linear-remote'),
    ('connectors-pack', 'mcp-catalog', 'mcp-mongodb'),
    ('connectors-pack', 'mcp-catalog', 'mcp-notion'),
    ('connectors-pack', 'mcp-catalog', 'mcp-opendart'),
    ('connectors-pack', 'mcp-catalog', 'mcp-slack'),
    ('connectors-pack', 'mcp-catalog', 'mcp-tavily'),
    ('connectors-pack', 'mcp-catalog', 'open-design')
ON CONFLICT (kind, item_id) DO NOTHING;
