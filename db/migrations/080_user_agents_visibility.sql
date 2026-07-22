-- Migration 080 — user_agents.visibility (워크스페이스 공유 에이전트)
--
-- 2026-07-23. ChatGPT Work "워크스페이스 공유 에이전트 디렉토리" 동등 기능.
-- 사용자가 자신의 Custom Agent 를 워크스페이스(단일 인스턴스=단일 조직) 전체에 공유.
-- 기존 mcp_servers.visibility 관용구와 동형 — 'private'(기본, 소유자 전용) | 'shared'(전원 사용).
--
-- 보안: 공유는 읽기/사용만 연다. update/softDelete 는 저장소에서 이미 user_id 소유자 한정이라
-- 공유해도 편집·삭제 권한은 소유자에게만 남는다(구조적 보존). 외부 모델 fullId 는 소비자 본인의
-- BYOK 키로 해석되므로(072 주석·model-role-resolver) 키 누출 없음.
--
-- 멱등(ADD COLUMN IF NOT EXISTS + DO/EXCEPTION 제약 가드).

ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

DO $$ BEGIN
    ALTER TABLE user_agents ADD CONSTRAINT user_agents_visibility_chk
        CHECK (visibility IN ('private', 'shared'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 공유 에이전트 목록 조회 부분 인덱스 (listVisibleToUser 의 visibility='shared' 분기)
CREATE INDEX IF NOT EXISTS idx_user_agents_shared
    ON user_agents (visibility) WHERE visibility = 'shared';

COMMENT ON COLUMN user_agents.visibility IS
    'private(기본, 소유자 전용) | shared(워크스페이스 전원 사용). 편집/삭제는 shared 여도 소유자 한정.';
