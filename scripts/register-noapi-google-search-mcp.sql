-- ============================================
-- Register noapi-google-search-mcp as external MCP server
-- Run this against your PostgreSQL database to register the server.
--
-- Prerequisites:
--   pipx install noapi-google-search-mcp
--   playwright install chromium  (inside pipx venv)
--
-- Usage:
--   psql -d openmake_llm -f scripts/register-noapi-google-search-mcp.sql
-- ============================================

INSERT INTO mcp_servers (id, name, transport_type, command, args, env, url, enabled)
VALUES (
    'mcp_noapi_google_search',
    'noapi-google-search',
    'stdio',
    'noapi-google-search-mcp',
    NULL,
    '{"PYTHONUNBUFFERED": "1"}'::jsonb,
    NULL,
    TRUE
) ON CONFLICT (name) DO UPDATE SET
    command = EXCLUDED.command,
    env = EXCLUDED.env,
    enabled = EXCLUDED.enabled,
    updated_at = NOW();

-- Verify registration
SELECT id, name, transport_type, command, enabled, created_at
FROM mcp_servers
WHERE name = 'noapi-google-search';
