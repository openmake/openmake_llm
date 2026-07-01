-- 053: Allow one anonymous browser owner to have multiple conversation sessions.
--
-- `anon_session_id` is a browser-scoped anonymous owner id, not the conversation
-- session id itself. The previous unique index forced all new guest chats from
-- one browser to collapse into one existing session.

DROP INDEX IF EXISTS idx_sessions_anon;
CREATE INDEX IF NOT EXISTS idx_sessions_anon
    ON conversation_sessions(anon_session_id)
    WHERE anon_session_id IS NOT NULL;
