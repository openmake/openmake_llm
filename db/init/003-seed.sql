-- ============================================
-- OpenMake.Ai - Default Admin User
-- Password: admin123 (bcrypt hashed)
-- ============================================

INSERT INTO users (id, username, password_hash, email, role, is_active)
VALUES (
    'admin-default-001',
    'admin',
    '$2a$10$8K1p/a0dR1xqM0eGJi.sDOQP4RGIhBhEW2.HfGR7BjmJqC6V1Kyuy',
    'admin@openmake.ai',
    'admin',
    TRUE
) ON CONFLICT (username) DO NOTHING;

-- ============================================
-- 🔌 Default MCP Server: noapi-google-search-mcp
-- Google Search, Lens, Maps, Translate, etc. via headless Chromium
-- No API key required
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
