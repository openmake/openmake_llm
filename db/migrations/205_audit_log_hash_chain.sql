-- 205: 감사 로그 해시 체인 (하네스 v1.1 로드맵 P2 "감사 무결성")
--
-- audit_logs 는 사후 변경을 알아챌 방법이 없었다. AUDIT_HASH_CHAIN_ENABLED=true 면 앱이 새 감사 행마다
-- 체인 순번·직전 행 해시·자기 해시를 남긴다(services/audit/audit-chain, 기본 꺼짐 — 꺼져 있으면 세 컬럼은 NULL).
--
--  * chain_seq : 체인 순번(1부터, 앱이 advisory lock 아래에서 매긴다). NULL = 체인 밖 행.
--  * prev_hash : 직전 체인 행의 row_hash(첫 행은 genesis 상수).
--  * row_hash  : sha256(prev_hash + 정규화한 내용). 내용 = chain_seq·timestamp·action·user_id·resource_type·resource_id·
--                details(actor 제외). PII 익명화(ip_address·user_agent·details.actor 삭제, db-retention 7)는 해시에 들지 않아
--                체인을 깨지 않는다. 보존 기간에 지워지는 행(login.succeeded·security.authz_denied·resource_type agent_task)은
--                처음부터 체인에 넣지 않는다(config/audit-chain — 보존 삭제 조건과 한 쌍).
--
-- 기존 행·기존 동작 무영향(NULL 허용). 체인 순번 유일성은 부분 인덱스로 강제한다.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_seq BIGINT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS row_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_chain_seq ON audit_logs (chain_seq) WHERE chain_seq IS NOT NULL;

-- 작업 단위 감사 조회(GET /api/agent-tasks/:taskId/audit) — 도구 호출 감사 행의 details.taskId.
CREATE INDEX IF NOT EXISTS idx_audit_logs_details_task ON audit_logs ((details->>'taskId')) WHERE details ? 'taskId';

COMMENT ON COLUMN audit_logs.chain_seq IS '감사 해시 체인 순번(AUDIT_HASH_CHAIN_ENABLED). NULL = 체인 밖 행 (205)';
COMMENT ON COLUMN audit_logs.prev_hash IS '직전 체인 행의 row_hash, 첫 행은 genesis (205)';
COMMENT ON COLUMN audit_logs.row_hash IS 'sha256(prev_hash + 정규화 내용) — 내용에 ip·user_agent·details.actor 는 들지 않는다 (205)';
