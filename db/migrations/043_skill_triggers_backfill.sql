-- 043_skill_triggers_backfill.sql
-- 스킬 triggers 백필 — 키워드형 description(쉼표 구분, 짧은) → manifest_meta.triggers.
--   triggers 는 skill-manager.formatTriggerHint 가 "(적용 상황: ...)" 힌트로 노출(렌더 시 8개 cap).
--   LLM self-select(load_skill, PR #150)·에이전트 바인딩 스킬 주입의 description-steering 보조.
--
-- 안전:
--   - 재시드 안전: upsertSystemSkill 의 INSERT/ON CONFLICT 는 manifest_meta 를 건드리지 않으므로
--     여기서 백필한 triggers 는 부팅 재시드에도 보존된다(시드 데이터 파일 변경 불필요).
--   - 멱등: 이미 triggers 보유 스킬은 skip. 재실행 안전.
--   - 문장형(긴) description 은 쉼표 분리 시 조각이 어색하므로 제외(length<=80 + 쉼표 有 만).
--   - 운영 DB owner mismatch 대비 DO+EXCEPTION(graceful).

DO $$
BEGIN
    UPDATE agent_skills
    SET manifest_meta = jsonb_set(
            coalesce(manifest_meta, '{}'::jsonb),
            '{triggers}',
            to_jsonb(ARRAY(
                SELECT btrim(t)
                FROM unnest(string_to_array(description, ',')) AS t
                WHERE btrim(t) <> ''
            ))
        )
    WHERE coalesce(btrim(description), '') <> ''
      AND position(',' IN description) > 0          -- 키워드형(쉼표 구분)만
      AND length(btrim(description)) <= 80           -- 문장형(긴 description) 제외
      AND NOT (manifest_meta ? 'triggers'
               AND jsonb_array_length(coalesce(manifest_meta->'triggers', '[]'::jsonb)) > 0);
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'agent_skills UPDATE 권한 없음 — owner 로 수동 적용 필요 (graceful skip)';
    WHEN undefined_table THEN
        RAISE NOTICE 'agent_skills 테이블 부재 (graceful skip)';
END $$;
