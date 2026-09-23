-- 공통 Job Runtime (Base·Add-on 통합 P07/P07b, 2026-09-23) — orchestrator_jobs 확장(expand-first)
--
-- 종전 표는 `(user_id, provider_id, job_id)` 유니크 + status(pending|completed|failed) + result_path 뿐이었다(119·121).
-- 여기에 계획서 11.1 필드를 **추가**한다. 기존 행과 기존 읽기 경로(`status`·`result_path`·`listRecent`)는 그대로 두고,
-- 새 상태 기계는 `state` 컬럼이 든다(legacy 행은 아래 백필로 매핑). 컬럼 삭제는 하지 않는다.
--   · 제출 의도를 먼저 영속화한 뒤 provider 에 보낸다 — 외부 job id 를 받기 전이라 job_id 는 NULL 을 허용한다.
--   · 응답 유실은 submission_unknown — 자동 재제출하지 않는다(중복 과금).
--   · lease + fencing_token(P07b): 원자적 조건부 갱신으로 lease 를 얻고, 확정 쓰기는 현재 token 이 일치할 때만.

ALTER TABLE orchestrator_jobs ALTER COLUMN job_id DROP NOT NULL;

ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS state            VARCHAR(24);
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS stage            VARCHAR(40);
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS progress         SMALLINT;
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS addon_id         VARCHAR(120);
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS addon_version    VARCHAR(40);
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS contract_version SMALLINT;
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS model_id         TEXT;
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS org_id           TEXT;
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS idempotency_key  VARCHAR(120);
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS request_digest   CHAR(64);
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS retry_count      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS next_poll_at     TIMESTAMPTZ;
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS deadline         TIMESTAMPTZ;
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS lease_owner      VARCHAR(120);
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS fencing_token    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS artifact_ids     TEXT[];
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS error_code       VARCHAR(60);
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS trace_id         VARCHAR(64);
-- 재조회 때 쓸 자격증명 참조(예: `user:<provider>` · `server:<provider>`) — 원문 키는 저장하지 않는다
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS credential_ref   VARCHAR(160);

-- legacy 행 매핑: pending→running(외부 job 이 이미 있다) · completed→completed · failed→failed · 그 외는 수동 확인
UPDATE orchestrator_jobs
   SET state = CASE status WHEN 'pending' THEN 'running' WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'manual_review' END,
       addon_id = COALESCE(addon_id, 'legacy')
 WHERE state IS NULL;

-- 같은 소유 scope·capability·클라이언트 idempotency key 는 하나 — 같은 key·다른 digest 는 앱이 충돌 오류로 돌린다
CREATE UNIQUE INDEX IF NOT EXISTS uq_orchestrator_jobs_idempotency
    ON orchestrator_jobs (user_id, capability, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orchestrator_jobs_poll
    ON orchestrator_jobs (next_poll_at) WHERE state IN ('running', 'collecting');
