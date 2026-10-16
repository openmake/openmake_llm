-- Knowledge 작업 큐 3차(2026-10-16, 설계 §5 C4) — 작업 actor·정책 revision·취소 요청 열, worker 모드 단일 행, worker heartbeat.
-- 네임스페이스 addon:knowledge-runtime:004. 전부 additive·멱등:
--   열은 ADD COLUMN IF NOT EXISTS, 제약은 DROP CONSTRAINT IF EXISTS 뒤 ADD(001 에는 state CHECK 가 없었다 — 처음 생긴다),
--   표는 CREATE TABLE IF NOT EXISTS, 시드는 ON CONFLICT DO NOTHING.
-- 롤백: 코드만 되돌려도 동작한다 — 새 열은 NULL 허용(옛 코드는 읽지 않는다), 'cancelled' 는 옛 claim 의
-- state IN ('queued','running') 에 걸리지 않는다. 단 옛 코드는 모드 행을 보지 않으므로 코드를 되돌릴 때는
-- 별도 worker 프로세스를 먼저 내린다(docs/architecture/addon-platform.md §9).

-- ① 작업 접수 주체·정책 revision·취소 요청
ALTER TABLE knowledge_ingestion_jobs ADD COLUMN IF NOT EXISTS actor_kind VARCHAR(10);          -- user | org | system (NULL = 004 이전 행, 시스템 작업으로 본다)
ALTER TABLE knowledge_ingestion_jobs ADD COLUMN IF NOT EXISTS actor_user_id TEXT;              -- 접수한 사용자(system 이면 요청자 기록용, 없을 수 있음)
ALTER TABLE knowledge_ingestion_jobs ADD COLUMN IF NOT EXISTS org_id TEXT;                     -- 조직 Space 작업의 조직 id
ALTER TABLE knowledge_ingestion_jobs ADD COLUMN IF NOT EXISTS policy_revision INTEGER;         -- 접수 시점 addon_installations.state_revision(조회 실패면 NULL)
ALTER TABLE knowledge_ingestion_jobs ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ; -- 취소 요청 시각(실행 중이면 heartbeat 가 읽고 멈춘다)

ALTER TABLE knowledge_ingestion_jobs DROP CONSTRAINT IF EXISTS knowledge_ingestion_jobs_state_check;
ALTER TABLE knowledge_ingestion_jobs ADD CONSTRAINT knowledge_ingestion_jobs_state_check
    CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled'));

ALTER TABLE knowledge_ingestion_jobs DROP CONSTRAINT IF EXISTS knowledge_ingestion_jobs_actor_kind_check;
ALTER TABLE knowledge_ingestion_jobs ADD CONSTRAINT knowledge_ingestion_jobs_actor_kind_check
    CHECK (actor_kind IS NULL OR actor_kind IN ('user', 'org', 'system'));

-- 소유자 취소 조회(본인 작업만)
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_actor_user ON knowledge_ingestion_jobs(actor_user_id) WHERE actor_user_id IS NOT NULL;

-- ② worker 모드 — claim 권한의 authority. 단일 행(id=1). 소비자는 claim 때 자기 종류와 대조해 다르면 집지 않는다.
--    generation 은 전환마다 +1(scripts/knowledge-worker-mode.sh) — 롤백 훈련과 /api/health 가 전환을 확인하는 표지.
CREATE TABLE IF NOT EXISTS knowledge_worker_mode (
    id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    mode        TEXT NOT NULL DEFAULT 'inprocess' CHECK (mode IN ('inprocess', 'external')),
    generation  INTEGER NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO knowledge_worker_mode (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ③ 소비자 heartbeat — 소비자 프로세스(API inprocess poller·별도 worker)가 주기적으로 갱신한다. 오래된 행은 갱신 때 지운다.
CREATE TABLE IF NOT EXISTS knowledge_worker_heartbeats (
    worker_id   TEXT PRIMARY KEY,
    mode        TEXT NOT NULL CHECK (mode IN ('inprocess', 'external')),
    generation  INTEGER NOT NULL,
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    inflight    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_knowledge_worker_heartbeats_mode ON knowledge_worker_heartbeats(mode, last_seen DESC);
