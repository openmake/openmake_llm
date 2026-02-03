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
