-- 206: Custom Agent 승인 상태 (확장 설치 보안 1단계)
--
-- 확장(플러그인)의 agents/*.md 를 Custom Agent 로 바꿔 설치하면 외부 저장소의 시스템 프롬프트가 검토 없이 바로 활성이 됐다
-- (스킬·MCP 서버는 draft → 승인). opt-in EXTENSION_AGENT_APPROVAL_REQUIRED=true 면 확장 설치분은 pending 으로 들어와
-- 승인함에서 승인해야 실행·목록·공유에 나온다. 옵션이 꺼져 있으면 모든 행이 approved 라 이 컬럼은 동작에 영향이 없다.
--
--  * approval_status : approved | pending. 기존 행·사용자가 직접 만든 에이전트는 approved(기본값) — 기존 동작 무영향.
--  * is_active 는 soft-delete 계약 그대로다(draft 용도로 쓰지 않는다).
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved';

DO $$ BEGIN
    ALTER TABLE user_agents ADD CONSTRAINT user_agents_approval_status_check
        CHECK (approval_status IN ('approved', 'pending'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 승인함·배지 조회(사용자별 pending)
CREATE INDEX IF NOT EXISTS idx_user_agents_pending
    ON user_agents(user_id) WHERE approval_status = 'pending' AND is_active = TRUE;

COMMENT ON COLUMN user_agents.approval_status IS
    'approved | pending(확장 설치분 — 승인 전엔 실행·목록·공유 제외). 기존 행·직접 생성은 approved (206)';
