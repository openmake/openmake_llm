-- Migration 035 — Artifacts (claude.ai-style 산출물 패널)
-- 2026-05-26: LLM 응답 중 self-contained 산출물 (코드/HTML/SVG/markdown/mermaid 등) 을
-- 채팅 본문에서 분리해 우측 패널에 표시 + DB 영속화.
--
-- 메시지 본문에는 [[artifact:id:vN]] placeholder 만 저장 → 메시지 비대 방지 +
-- 다음 턴 prompt 에 본문 미포함 (Anthropic 의 "edits won't change Claude's memory" 패턴).

CREATE TABLE IF NOT EXISTS artifacts (
    pk_id          BIGSERIAL PRIMARY KEY,
    -- LLM 이 응답 시 생성한 안정 식별자 (kebab-case). 같은 id = 같은 산출물의 버전 묶음.
    artifact_id    VARCHAR(80) NOT NULL,
    version        INTEGER NOT NULL DEFAULT 1,
    -- 같은 세션 안에서 id 별 버전 누적 — 사용자가 좌우 화살표로 history 탐색.
    -- session_id / message_id 는 conversation_sessions.id / conversation_messages.id 와
    -- 타입 일치 (TEXT) — 우리 프로젝트의 [[project_users_id_text]] 패턴.
    session_id     TEXT NOT NULL,
    message_id     TEXT,
    user_id        TEXT,
    -- markdown | code | html | svg | mermaid | react | chart | csv | slide | excalidraw
    kind           VARCHAR(20) NOT NULL,
    title          VARCHAR(200) NOT NULL,
    -- code 인 경우 언어 (python/js/ts/...). 다른 kind 는 NULL.
    language       VARCHAR(40),
    -- 본문. application 측에서 20MB 검증 (Anthropic 공식 한도와 동일).
    content        TEXT NOT NULL,
    -- LLM 이 인용한 외부 의존성 (예: chart spec 의 라이브러리 버전) — JSONB. 미사용 시 NULL.
    deps           JSONB,
    created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    -- (session_id, artifact_id, version) 유니크 — 같은 세션 안에서 같은 id 의 같은 버전 중복 방지.
    CONSTRAINT artifacts_session_artifact_version_uniq
        UNIQUE (session_id, artifact_id, version)
);

-- FK 는 graceful 패턴 — chat_sessions / messages / users 가 다른 owner 인 경우 대응.
DO $$
BEGIN
    BEGIN
        ALTER TABLE artifacts
            ADD CONSTRAINT artifacts_session_fk
            FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'artifacts_session_fk skip: %', SQLERRM;
    END;
    BEGIN
        ALTER TABLE artifacts
            ADD CONSTRAINT artifacts_user_fk
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'artifacts_user_fk skip: %', SQLERRM;
    END;
END $$;

-- 빠른 조회: 세션의 artifact 목록 (id 그룹, 최신 버전 우선)
CREATE INDEX IF NOT EXISTS idx_artifacts_session
    ON artifacts(session_id, artifact_id, version DESC);

-- 사용자별 최근 artifact (별도 페이지 또는 검색용)
CREATE INDEX IF NOT EXISTS idx_artifacts_user_created
    ON artifacts(user_id, created_at DESC);

-- 사용자 설정: Artifacts on/off (Anthropic Settings > Capabilities 동등).
-- 기본 ON — 사용자가 명시적으로 끄지 않는 한 활성.
ALTER TABLE users ADD COLUMN IF NOT EXISTS artifacts_enabled BOOLEAN DEFAULT TRUE;
