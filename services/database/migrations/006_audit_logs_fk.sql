-- ============================================================
-- Migration 006: audit_logs.user_id FK 추가
-- ============================================================
--
-- 목적: audit_logs 테이블의 user_id 컬럼에 FK 제약을 추가합니다.
--       사용자 삭제 시 감사 로그는 보존되고 user_id만 NULL로 설정됩니다.
--
-- 실행 방법:
--   psql -d openmake_llm -f services/database/migrations/006_audit_logs_fk.sql
--
-- 롤백:
--   ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS fk_audit_logs_user_id;
--   DELETE FROM migration_versions WHERE version = '006';
--
-- ============================================================

-- 마이그레이션 버전 기록
INSERT INTO migration_versions (version, filename)
VALUES ('006', '006_audit_logs_fk.sql')
ON CONFLICT (version) DO NOTHING;

-- audit_logs.user_id → users(id) FK 추가 (ON DELETE SET NULL)
-- 감사 추적 보존을 위해 사용자 삭제 시 NULL 처리
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_audit_logs_user_id'
          AND table_name = 'audit_logs'
    ) THEN
        ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================================
-- 검증 쿼리 (수동 실행)
-- ============================================================
-- SELECT constraint_name, constraint_type
-- FROM information_schema.table_constraints
-- WHERE table_name = 'audit_logs' AND constraint_type = 'FOREIGN KEY';
