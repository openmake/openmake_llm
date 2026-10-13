-- 187: 근거 게이트를 문장 단위로 — 인용 문장마다 그 문장이 인용한 출처와 짝지어 판정한 결과를 남길 열.
--
-- 186 은 답 전체와 출처 전체를 한 번에 물었는데 운영 기록에서 구분이 없었다(0.26~0.66). 문장 단위로 바꾼다.
-- p_true 는 이제 문장별 확률 중 가장 낮은 값이다. 방식이 다른 행을 섞어 읽지 않도록 method 로 가른다
-- (이 마이그레이션 전의 행은 기본값 'answer').
-- 문장별 결과(claims)에는 출처 번호와 확률만 넣는다 — 본문은 여전히 저장하지 않는다.
-- 멱등(IF NOT EXISTS). 되돌리기: rollbacks/187_grounding_gate_claims_rollback.sql

ALTER TABLE chat_grounding_gate_log
    ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'answer',
    ADD COLUMN IF NOT EXISTS claim_count INTEGER,
    ADD COLUMN IF NOT EXISTS low_count INTEGER,
    ADD COLUMN IF NOT EXISTS claims JSONB;

COMMENT ON COLUMN chat_grounding_gate_log.method IS 'answer(186 — 답 전체 대 출처 전체) | claim(187 — 인용 문장 대 인용한 출처)';
COMMENT ON COLUMN chat_grounding_gate_log.p_true IS 'answer: 답이 출처에 근거했을 확률. claim: 문장별 확률 중 가장 낮은 값. 판정된 것이 없으면 NULL';
COMMENT ON COLUMN chat_grounding_gate_log.claim_count IS '확인한 인용 문장 수. 0 이면 인용 문장이 없어 판정하지 않은 답';
COMMENT ON COLUMN chat_grounding_gate_log.low_count IS '기준(CHAT_GROUNDING_GATE_LOW_THRESHOLD) 미만으로 나온 문장 수';
COMMENT ON COLUMN chat_grounding_gate_log.claims IS '문장별 결과 [{n: 출처 번호, p: 확률 또는 null}] — 본문 없음';
