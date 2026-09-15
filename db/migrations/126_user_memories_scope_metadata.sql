-- 126: 범위 메모리 메타데이터 (로드맵 4단계 "Memory and Audit", 2026-09-16)
--
-- user_memories 에는 source(explicit/candidate/batch)와 is_active 뿐이라 "어디까지 적용되는가·
-- 얼마나 믿을 만한가·민감한가·언제까지인가"를 표현할 수 없었다. 네 컬럼을 더한다(기존 행은 기본값).
--   scope       user(기본) | session | task — 주입 범위. 현재 주입 경로는 user 만 읽는다.
--   confidence  0..1 — 출처별 기본값(config/memory-metadata): explicit 1.0 · batch 0.8 · candidate 0.7
--   sensitivity normal(기본) | sensitive — 자격증명·개인식별 패턴. 자동 추출은 sensitive 후보를 저장하지 않는다
--   expires_at  NULL(무기한) 또는 만료 시각 — 자동 추출 후보는 기본 TTL, 지난 행은 주입·목록에서 제외
ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'user';
ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS confidence REAL;
ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS sensitivity TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_user_memories_active_scope
    ON user_memories(user_id, scope) WHERE is_active = TRUE;

COMMENT ON COLUMN user_memories.scope IS '주입 범위: user | session | task (126)';
COMMENT ON COLUMN user_memories.confidence IS '0..1 출처별 신뢰도 — explicit 1.0 · batch 0.8 · candidate 0.7 (126)';
COMMENT ON COLUMN user_memories.sensitivity IS 'normal | sensitive — 자격증명·개인식별 패턴 매칭 (126)';
COMMENT ON COLUMN user_memories.expires_at IS 'NULL=무기한. 지난 행은 주입·목록에서 제외 (126)';
