-- ============================================================
-- 086: 오케스트레이션 자동 배정 Stage 2 — 셰도우 계측 테이블
-- ============================================================
-- Stage 1(모델이 start_discussion/delegate_agent_task 를 도구로 배정, PR #417)의
-- 관측 계층. 의도 프리필터 노출 대비 실제 호출률, 사용자 토글과의 상관을 적재해
-- 패턴 튜닝·활성화 기준 판단의 근거로 쓴다 (tail routing_shadow_decisions 패턴).
--
-- 분석 예시:
--   -- 노출 대비 호출률 (도구별)
--   SELECT tool_called, count(*) FROM orchestration_dispatch_decisions
--    WHERE discussion_intent OR task_delegate_intent GROUP BY tool_called;
--   -- 사용자 토글 턴에서 의도 패턴이 잡혔는가 (재현율 프록시)
--   SELECT user_mode, discussion_intent, count(*) FROM orchestration_dispatch_decisions
--    WHERE user_mode <> 'none' GROUP BY 1, 2;

CREATE TABLE IF NOT EXISTS orchestration_dispatch_decisions (
    id BIGSERIAL PRIMARY KEY,
    request_id TEXT,
    user_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    query_length INTEGER NOT NULL DEFAULT 0,
    -- 프리필터 의도 판정 (노출 게이트)
    discussion_intent BOOLEAN NOT NULL DEFAULT false,
    task_delegate_intent BOOLEAN NOT NULL DEFAULT false,
    -- 이 턴에 노출된 오케스트레이션 도구 이름 목록 (빈 배열 = 미노출)
    tools_exposed TEXT[] NOT NULL DEFAULT '{}',
    -- 모델이 실제 호출한 도구 (NULL = 노출됐지만 미호출 — 모델 재량 직접 답변)
    tool_called TEXT,
    -- 호출 결과 성공 여부 (도구 결과가 Error 로 시작하지 않음)
    tool_success BOOLEAN,
    -- 같은 턴의 사용자 수동 토글: discussion | deep-research | none
    user_mode TEXT NOT NULL DEFAULT 'none'
);

CREATE INDEX IF NOT EXISTS idx_orch_dispatch_created
    ON orchestration_dispatch_decisions (created_at);
