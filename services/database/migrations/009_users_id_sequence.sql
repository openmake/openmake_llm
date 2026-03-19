-- Migration 009: users.id 생성 방식을 PostgreSQL 시퀀스로 전환
-- 롤백: DROP SEQUENCE IF EXISTS users_id_seq;

INSERT INTO migration_versions (version, filename)
VALUES ('009', '009_users_id_sequence.sql')
ON CONFLICT (version) DO NOTHING;

-- 기존 최대 정수 ID 기반으로 시퀀스 초기화
DO $$
DECLARE
    max_int_id INTEGER;
BEGIN
    SELECT COALESCE(MAX(CAST(id AS INTEGER)), 0) INTO max_int_id
    FROM users
    WHERE id ~ '^\d+$';

    -- 시퀀스가 없으면 생성
    IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'users_id_seq') THEN
        EXECUTE format('CREATE SEQUENCE users_id_seq START %s', max_int_id + 1);
    END IF;
END $$;
