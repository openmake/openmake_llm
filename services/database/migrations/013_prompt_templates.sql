-- ============================================================
-- 013_prompt_templates.sql - Prompt DB Registry 스키마
-- ============================================================
--
-- Phase 2.5 Prompt DB Registry 1단계 (스키마만):
--   기존 backend/api/src/chat/prompt-templates.ts 코드 인라인 프롬프트를
--   DB로 외부화하기 위한 데이터 계층. CLAUDE.md No-Hardcoding Policy(L3)
--   준수.
--
-- 본 마이그레이션은 스키마/인덱스만 생성합니다.
-- - Admin UI / 핫스왑 / 시드 프롬프트는 별도 PR에서 추가
-- - 시드 데이터를 여기서 INSERT하지 않습니다 (프롬프트 본문은 외부 파일/관리자 도구에서 주입)
--
-- 테이블:
--   1. prompt_templates          - 활성(현재) 프롬프트 템플릿 (name UNIQUE)
--   2. prompt_template_versions  - 버전 히스토리 (감사/롤백용)
--
-- 롤백:
--   DROP TABLE IF EXISTS prompt_template_versions;
--   DROP TABLE IF EXISTS prompt_templates;
--   DELETE FROM migration_versions WHERE version = '013';
-- ============================================================

INSERT INTO migration_versions (version, filename)
VALUES ('013', '013_prompt_templates.sql')
ON CONFLICT (version) DO NOTHING;

-- ── 1. 활성 프롬프트 템플릿 ────────────────────────────────
-- 한 name당 하나의 활성 행. version은 현재 활성 버전 번호.
-- 콘텐츠 변경은 prompt_template_versions에 INSERT + 본 테이블 UPDATE 동기화 (트랜잭션).
CREATE TABLE IF NOT EXISTS prompt_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(128) NOT NULL UNIQUE,
    category    VARCHAR(32)  NOT NULL DEFAULT 'system',  -- 'system' | 'agent' | 'discussion' 등
    content     TEXT         NOT NULL,
    language    VARCHAR(8)   NOT NULL DEFAULT 'ko',
    version     INTEGER      NOT NULL DEFAULT 1,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT prompt_templates_version_positive CHECK (version >= 1)
);

-- ── 2. 버전 히스토리 ────────────────────────────────────────
-- 모든 콘텐츠 변경 이력. 활성 버전은 prompt_templates.version과 동기화.
-- 템플릿이 삭제되면 히스토리도 삭제 (운영 정리 단순화).
CREATE TABLE IF NOT EXISTS prompt_template_versions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id   UUID         NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
    version       INTEGER      NOT NULL,
    content       TEXT         NOT NULL,
    changed_by    VARCHAR(128),         -- nullable (시스템 마이그레이션 등)
    changed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    change_reason TEXT,
    CONSTRAINT prompt_template_versions_unique UNIQUE (template_id, version),
    CONSTRAINT prompt_template_versions_version_positive CHECK (version >= 1)
);

-- ── 3. 인덱스 ───────────────────────────────────────────────
-- name + is_active: 핫패스(findActiveByName) — name UNIQUE 인덱스가 이미 있지만
-- is_active 필터를 함께 사용하므로 부분 인덱스로 활성 행 빠른 조회.
CREATE INDEX IF NOT EXISTS idx_prompt_templates_name_active
    ON prompt_templates (name)
    WHERE is_active = TRUE;

-- category: listByCategory(category) 핫패스
CREATE INDEX IF NOT EXISTS idx_prompt_templates_category
    ON prompt_templates (category)
    WHERE is_active = TRUE;

-- (template_id, version) 복합: 히스토리 조회용 — UNIQUE 제약이 인덱스를 자동 생성하므로
-- 중복 인덱스를 만들지 않음 (UNIQUE constraint = btree index).

-- ── 4. updated_at 자동 갱신 트리거 ─────────────────────────
-- 본 테이블은 createVersion 등 명시적 UPDATE에서 NOW()를 직접 세팅하지만,
-- 안전망으로 트리거 추가 (다른 도구의 직접 UPDATE에도 일관성 보장).
CREATE OR REPLACE FUNCTION set_prompt_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prompt_templates_updated_at ON prompt_templates;
CREATE TRIGGER trg_prompt_templates_updated_at
    BEFORE UPDATE ON prompt_templates
    FOR EACH ROW
    EXECUTE FUNCTION set_prompt_templates_updated_at();

-- ============================================================
-- 검증 쿼리 (수동 실행)
-- ============================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE 'prompt_template%';
-- SELECT indexname FROM pg_indexes WHERE tablename LIKE 'prompt_template%';
-- SELECT conname FROM pg_constraint WHERE conrelid = 'prompt_template_versions'::regclass;
