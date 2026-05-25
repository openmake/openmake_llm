-- Migration 034 — user_memories 테이블
--
-- 사용자별 cross-conversation memory (claude.ai Memory / ChatGPT Memory 동등).
-- explicit 명령 (/remember) 으로 저장된 사실을 다음 대화의 system prompt 에
-- prepend.
--
-- 도입 배경 (2026-05-26): mainstream gap closure Phase 3-A. 2026-05-19 폐기된
-- MemoryService 의 lightweight 재도입 — auto-extraction 없이 explicit 만.
-- vLLM 부담 0 (추가 LLM 호출 없음).
--
-- 저장 방식:
--   - source='explicit' — 사용자가 직접 입력
--   - source='candidate' — 모델 응답의 <memory-candidate> tag (Phase K, 미래)
--   - source='batch' — 일괄 추출 (Phase 3-C, 미래)
--
-- max-per-user 정책은 application layer (env USER_MEMORY_MAX_COUNT, default 50)

CREATE TABLE IF NOT EXISTS user_memories (
    id            TEXT PRIMARY KEY,                       -- uuid
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content       TEXT NOT NULL,                           -- 기억할 사실 (사용자 자연어)
    source        TEXT NOT NULL DEFAULT 'explicit'
                    CHECK (source IN ('explicit', 'candidate', 'batch')),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    accessed_at   TIMESTAMPTZ,                             -- 최근 prepend 시점 (LRU 정책 미래 대비)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user_active
    ON user_memories(user_id, is_active, created_at DESC) WHERE is_active = TRUE;

COMMENT ON TABLE user_memories IS
    '사용자별 cross-conversation memory. /remember slash command 로 저장, 매 chat 요청 시 system prompt 에 prepend (claude.ai/ChatGPT Memory 동등). 2026-05-26 mainstream gap closure Phase 3-A.';
COMMENT ON COLUMN user_memories.source IS 'explicit (사용자 명시) | candidate (모델 감지, Phase K 미래) | batch (일괄 추출, Phase 3-C 미래)';
