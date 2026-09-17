-- 157: 대화 폴더·태그 (2026-09-17, F19.5) — 폴더는 사용자 소유, 태그는 세션 TEXT[]. 익명 세션은 대상 외
CREATE TABLE IF NOT EXISTS conversation_folders (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_conversation_folders_user ON conversation_folders(user_id, position);

ALTER TABLE conversation_sessions ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES conversation_folders(id) ON DELETE SET NULL;
ALTER TABLE conversation_sessions ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_sessions_folder ON conversation_sessions(user_id, folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_tags ON conversation_sessions USING GIN (tags);
COMMENT ON TABLE conversation_folders IS '대화 폴더(157) — 사용자 소유, 삭제 시 세션 folder_id NULL';
