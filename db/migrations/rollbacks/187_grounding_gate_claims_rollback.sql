-- 187 되돌리기: 문장 단위 근거 판정 열 제거.
ALTER TABLE chat_grounding_gate_log
    DROP COLUMN IF EXISTS method,
    DROP COLUMN IF EXISTS claim_count,
    DROP COLUMN IF EXISTS low_count,
    DROP COLUMN IF EXISTS claims;
