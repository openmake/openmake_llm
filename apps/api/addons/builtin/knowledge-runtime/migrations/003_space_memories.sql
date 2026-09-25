-- Knowledge Space 메모리(MVP, 수동만) — Space 소유자가 손으로 적어 두는 항목. 자동 추출 없음(2026-09-25).
-- 네임스페이스 addon:knowledge-runtime:003. 멱등(IF NOT EXISTS · jsonb 는 없을 때만).
--
-- 권한: 읽기 = Space 읽기, 쓰기 = Space 쓰기(서비스가 scope 정책으로 판정). 삭제는 tombstone(deleted_at).
-- 정책값(항목 수·항목당 문자 수·주입 토큰 예산)은 knowledge_profiles.limits 데이터다(코드 폴백은 config/injection.ts).

CREATE TABLE IF NOT EXISTS knowledge_space_memories (
    id          TEXT PRIMARY KEY,
    space_id    TEXT NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_knowledge_space_memories_space
    ON knowledge_space_memories(space_id) WHERE deleted_at IS NULL;

-- limits 프로필에 메모리 정책·주입 예산 키를 각각 없을 때만 추가한다(이미 바꾼 값은 보존).
UPDATE knowledge_profiles SET config = config || jsonb_build_object('maxMemoryItems', 100)
WHERE kind = 'limits' AND NOT (config ? 'maxMemoryItems');

UPDATE knowledge_profiles SET config = config || jsonb_build_object('maxMemoryCharsPerItem', 2000)
WHERE kind = 'limits' AND NOT (config ? 'maxMemoryCharsPerItem');

UPDATE knowledge_profiles SET config = config || jsonb_build_object('maxMemoryTokens', 1500)
WHERE kind = 'limits' AND NOT (config ? 'maxMemoryTokens');
