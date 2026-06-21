-- ============================================================
-- 022_seed_manifests_from_legacy.sql — agent_skills → skill_manifests v1.0.0 자동 복사
-- ============================================================
--
-- 무영향 마이그레이션:
--   - 기존 agent_skills (100 system skill + 사용자 skill) 를
--     skill_manifests v1.0.0 으로 복사.
--   - binding 비어 있어 채팅 동작 무변경 (PipelineProfile.requiredTools 만 적용).
--   - YAML frontmatter 는 최소 형식만 생성: name/description/category.
--   - checksum 은 prompt_md (= content) 의 sha256.
--   - 재실행 안전: ON CONFLICT DO NOTHING (id+version PK 충돌 시 skip).
--
-- 참조: docs/superpowers/plans/2026-05-20-openmake-llm-skill-mcp-redesign.md §4.2
-- ============================================================

INSERT INTO skill_manifests (id, version, manifest_yaml, prompt_md, checksum, created_by, is_public, created_at)
SELECT
    s.id,
    '1.0.0' AS version,
    format(E'---\nname: %s\ndescription: %s\ncategory: %s\n---\n',
           s.name,
           s.description,
           COALESCE(s.category, '')) AS manifest_yaml,
    s.content AS prompt_md,
    encode(sha256(s.content::bytea), 'hex') AS checksum,
    s.created_by,
    s.is_public,
    COALESCE(s.created_at, NOW())
FROM agent_skills s
ON CONFLICT (id, version) DO NOTHING;
