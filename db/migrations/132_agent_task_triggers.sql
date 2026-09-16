-- 132: 인바운드 웹훅 트리거 (2026-09-17, F16.5) — 서명 검증 후 템플릿으로 작업 생성·큐 제출
-- 수신은 무인증 POST /api/triggers/:id — X-Openmake-Timestamp(±창) + X-Openmake-Signature: sha256=HMAC(secret, ts.rawBody).
-- template_id 는 FK 를 두지 않는다 — 조직 공유 템플릿을 소유자가 지우면 다른 사용자의 트리거가 조용히 사라지므로,
-- 발화 시점에 템플릿을 확인하고 실패를 consecutive_failures 로 센다(상한이면 자동 비활성).
CREATE TABLE IF NOT EXISTS agent_task_triggers (
    id                   TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id          TEXT NOT NULL,
    name                 TEXT NOT NULL,
    secret_encrypted     TEXT NOT NULL,
    enabled              BOOLEAN NOT NULL DEFAULT TRUE,
    approval_policy      TEXT NOT NULL DEFAULT 'all',
    last_delivery_id     TEXT,
    last_fired_at        TIMESTAMPTZ,
    last_task_id         TEXT,
    fire_count           INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_error           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_task_triggers_user ON agent_task_triggers(user_id);
COMMENT ON TABLE agent_task_triggers IS '인바운드 웹훅 → 에이전트 작업 트리거. 수신은 HMAC-SHA-256 서명 + 타임스탬프 창(132)';
COMMENT ON COLUMN agent_task_triggers.secret_encrypted IS 'utils/token-crypto 암호문 — 평문은 생성·재발급 응답에 1회만(132)';
COMMENT ON COLUMN agent_task_triggers.approval_policy IS '트리거로 만든 작업의 승인 정책 — 무인 실행 기본은 가장 보수적인 all(132)';
