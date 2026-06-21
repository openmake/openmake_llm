-- ============================================================
-- 036_seed_karpathy_skill_rollback.sql — 036 역적용
-- ============================================================
DELETE FROM agent_skill_assignments WHERE agent_id = '__global__' AND skill_id = 'system-skill-karpathy-guidelines';
DELETE FROM skill_tool_bindings      WHERE skill_id = 'system-skill-karpathy-guidelines';
DELETE FROM skill_manifests          WHERE id = 'system-skill-karpathy-guidelines';
DELETE FROM agent_skills             WHERE id = 'system-skill-karpathy-guidelines';
