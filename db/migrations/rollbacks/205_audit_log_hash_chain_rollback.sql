-- 205 되돌리기 — 감사 해시 체인 컬럼·인덱스를 지운다. 코드 참조(audit-chain·audit-repository chain 경로)를 먼저 걷어낸 뒤 실행한다.
DROP INDEX IF EXISTS idx_audit_logs_details_task;
DROP INDEX IF EXISTS idx_audit_logs_chain_seq;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS row_hash;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS prev_hash;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS chain_seq;
