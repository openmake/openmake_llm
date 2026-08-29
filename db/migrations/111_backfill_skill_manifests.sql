-- Migration 111 — skill_manifests 백필 (manifest 없는 active 스킬)
--
-- 2026-08-29. 시스템 프롬프트 주입의 SoT 는 skill_manifests (skill-manager.buildManifestPrompt JOIN)
-- 인데, 022 이후 만들어진 스킬 중 manifest 를 안 만드는 생성 경로(SkillRepository.createSkill·
-- upsertSystemSkill·skill-creator)로 들어온 21건은 에이전트에 배정돼 있어도 한 번도 주입되지
-- 않았다 (user 3 ecc 14건 실측 — skill_audit_log 첫 기록에서 inject 누락으로 드러남).
-- 022 와 같은 형식으로 v1.0.0 manifest 를 만든다. signature='backfill-111' 이 롤백 마커.
--
-- 멱등: 이미 manifest 가 있는 스킬은 건너뛴다 (NOT EXISTS + ON CONFLICT DO NOTHING).

INSERT INTO skill_manifests (id, version, manifest_yaml, prompt_md, checksum, signature, created_by, is_public, created_at)
SELECT
    s.id,
    '1.0.0' AS version,
    format(E'---\nname: %s\ndescription: %s\ncategory: %s\n---\n',
           replace(s.name, E'\n', ' '),
           replace(COALESCE(s.description, ''), E'\n', ' '),
           COALESCE(s.category, 'general')) AS manifest_yaml,
    s.content AS prompt_md,
    encode(sha256(convert_to(s.content, 'UTF8')), 'hex') AS checksum,
    'backfill-111' AS signature,
    s.created_by,
    COALESCE(s.is_public, FALSE),
    COALESCE(s.created_at, NOW())
FROM agent_skills s
WHERE s.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM skill_manifests m WHERE m.id = s.id)
ON CONFLICT (id, version) DO NOTHING;
