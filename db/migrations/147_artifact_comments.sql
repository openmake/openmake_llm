-- Migration 147 — 아티팩트 댓글 (2026-09-17, F20.6)
--
-- artifacts(035)는 (session_id, artifact_id, version) 버전 묶음만 있고 협업 축이 없다.
-- 댓글은 논리적 아티팩트(session_id+artifact_id)에 귀속하고, 작성 시점 버전을 기록해
-- "어느 버전에 단 댓글인지" 를 보존한다. 실시간 공동편집(CRDT)은 도입하지 않는다 —
-- 편집 주체는 모델이고 새 버전으로만 바뀐다(035 설계 유지).
--
-- 접근권(앱 계층): 소유자 또는 artifact_publications.visibility='authenticated' 의 인증 사용자.
-- 렌더는 react-markdown(rehype-raw 없음) — body 는 마크다운 평문으로만 저장.
-- 멱등 (IF NOT EXISTS). FK 는 035/047 과 같은 graceful 패턴.

CREATE TABLE IF NOT EXISTS artifact_comments (
    id           BIGSERIAL PRIMARY KEY,
    session_id   TEXT NOT NULL,
    artifact_id  VARCHAR(80) NOT NULL,
    version      INTEGER NOT NULL,                 -- 작성 시점 버전(035.version)
    user_id      TEXT NOT NULL,
    parent_id    BIGINT REFERENCES artifact_comments(id) ON DELETE CASCADE,  -- 답글(1단계)
    body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    resolved_at  TIMESTAMPTZ,
    resolved_by  TEXT,
    deleted_at   TIMESTAMPTZ,                      -- soft delete(감사 보존)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    BEGIN
        ALTER TABLE artifact_comments
            ADD CONSTRAINT artifact_comments_session_fk
            FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'artifact_comments_session_fk skip: %', SQLERRM; END;
    BEGIN
        ALTER TABLE artifact_comments
            ADD CONSTRAINT artifact_comments_user_fk
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'artifact_comments_user_fk skip: %', SQLERRM; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_artifact_comments_lookup
    ON artifact_comments (session_id, artifact_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artifact_comments_user
    ON artifact_comments (user_id, created_at DESC);

COMMENT ON TABLE artifact_comments IS '아티팩트 댓글 — 논리적 아티팩트 귀속, 작성 버전 기록, soft delete. 접근권은 앱 계층(소유자/authenticated 게시).';
