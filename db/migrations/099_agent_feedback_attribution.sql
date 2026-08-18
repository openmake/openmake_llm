-- 099: 자가개선(F2) 루프 입력 배선 — 채팅 피드백의 에이전트 귀속
--
-- 배경: agent_prompt_suggestions 가 운영에서 0건이었다. 원인은 승인 UI 부재가 아니라
-- 루프의 '입력'이 끊겨 있던 것 —
--   ① conversation_messages.agent_id 컬럼은 있으나 실제 저장 경로(data/conversation-messages.ts)의
--      INSERT 가 해당 컬럼을 아예 쓰지 않아 assistant 829건 전부 NULL 이었다.
--   ② message_feedback.message_id 는 WS 가 스트리밍 상관용으로 만든 랜덤 UUID 라
--      conversation_messages(serial id) 와 조인 자체가 불가능했다(고아 row 3건).
--   ③ agent_feedback.agent_id 에 custom_agents FK 가 걸려 있어 산업 에이전트 id
--      (AGENTS 맵의 18 산업 에이전트) 는 INSERT 자체가 FK 위반으로 거부됐다.
--
-- 이 마이그레이션은 ②③의 스키마 측면을 해소한다(①은 애플리케이션 코드에서 처리).

-- ② WS/REST 가 클라이언트에 발급한 message id 를 메시지 행에 남겨 피드백과 조인 가능하게 한다.
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS client_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_client_message_id
    ON conversation_messages(client_message_id)
    WHERE client_message_id IS NOT NULL;

-- ③ agent_feedback.agent_id 의 custom_agents FK 제거.
--    agent_prompt_suggestions 가 같은 이유로 이미 FK 를 두지 않는다("산업/커스텀 agent id 혼용이라 FK 미설정").
--    db/init/002-schema.sql 의 정의에도 이 FK 는 없다 — legacy-schema 경로로 들어온 드리프트.
--    소유자 불일치/부재는 graceful (DO + EXCEPTION 래핑).
DO $$
BEGIN
    ALTER TABLE agent_feedback DROP CONSTRAINT IF EXISTS fk_agent_feedback_agent_id;
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE '099: agent_feedback FK 제거 권한 없음 — skip';
    WHEN undefined_table THEN
        RAISE NOTICE '099: agent_feedback 테이블 부재 — skip';
END $$;

-- 자가개선 사이클이 부팅 시 최근 피드백만 로드하므로 시간 역순 조회를 인덱스로 받친다.
CREATE INDEX IF NOT EXISTS idx_agent_feedback_created ON agent_feedback(created_at DESC);
