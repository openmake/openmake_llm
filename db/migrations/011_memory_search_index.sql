-- ============================================================
-- Migration 011: user_memories 검색 성능 개선
-- ============================================================
--
-- 목적 (P2-6):
--   user_memories.key/value 컬럼의 LIKE '%keyword%' 풀스캔 해결
--   pg_trgm GIN 인덱스 + external_files 정렬 인덱스 추가
--
-- pg_trgm 활성화 시: LIKE '%키워드%' 쿼리가 인덱스를 사용
-- pg_trgm 미설치 시: 기본 복합 인덱스로 fallback (importance/updated_at 정렬 최적화)
--
-- ============================================================

INSERT INTO migration_versions (version, filename)
VALUES ('011', '011_memory_search_index.sql')
ON CONFLICT (version) DO NOTHING;

-- pg_trgm 확장 활성화 (슈퍼유저 필요, 없으면 건너뜀)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'pg_trgm 확장 활성화를 건너뜁니다 (권한 부족). DBA가 수동으로 실행해주세요: CREATE EXTENSION pg_trgm;';
END $$;

-- ⚠️ 2026-07-31: 이 마이그레이션은 legacy MemoryService 의 key/value/importance 스키마를
-- 전제한다. 현행 user_memories 는 content 기반이라(db/init/002-schema.sql 참고) 신규 DB 에서는
-- 대상 컬럼이 없어 `column "key" does not exist` 로 부트스트랩이 중단됐다.
-- 기존 DB 는 이미 적용돼 재실행되지 않으므로, 신규 DB 에서 안전하게 건너뛰도록 컬럼 존재를
-- 확인한다. content 트라이그램 인덱스는 schema-initializer 가 부팅 시 생성하므로 목적은 이미
-- 대체돼 있다(idx_user_memories_content_trgm).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_memories' AND column_name = 'key'
    ) THEN
        RAISE NOTICE 'user_memories.key 없음 (content 기반 현행 스키마) — legacy 인덱스 생성을 건너뜁니다';
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        -- key 컬럼 트라이그램 인덱스
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_memories_key_trgm') THEN
            EXECUTE 'CREATE INDEX idx_memories_key_trgm ON user_memories USING GIN (LOWER(key) gin_trgm_ops)';
        END IF;
        -- value 컬럼 트라이그램 인덱스
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_memories_value_trgm') THEN
            EXECUTE 'CREATE INDEX idx_memories_value_trgm ON user_memories USING GIN (LOWER(value) gin_trgm_ops)';
        END IF;
        RAISE NOTICE 'pg_trgm GIN 인덱스 생성 완료';
    ELSE
        RAISE NOTICE 'pg_trgm 미설치 — trgm 인덱스를 건너뜁니다. fallback 인덱스 사용';
    END IF;
END $$;

-- user_memories 복합 정렬 인덱스 (importance DESC 정렬 최적화 — trgm 없이도 유효)
-- importance 역시 legacy 컬럼이라 현행 스키마에는 없다 (위 주석 참고).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_memories' AND column_name = 'importance'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_memories_user_importance
            ON user_memories(user_id, importance DESC, updated_at DESC);
    END IF;
END $$;

-- external_files 정렬 인덱스 (P2-5: 파일 목록 created_at DESC 정렬)
CREATE INDEX IF NOT EXISTS idx_ext_files_created
    ON external_files(connection_id, created_at DESC);

-- ============================================================
-- 검증 쿼리 (수동 실행)
-- ============================================================
-- SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename = 'user_memories' AND indexname LIKE '%trgm%';
