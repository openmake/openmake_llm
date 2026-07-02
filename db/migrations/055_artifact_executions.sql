-- 055: 아티팩트 코드 실행 결과 영속 (실행 히스토리)
--
-- POST /api/artifacts/execute 는 stateless --rm 컨테이너라 결과(stdout/stderr)를 저장하지
-- 않아, 패널을 닫거나 새로고침하면 출력이 사라졌다. 이 테이블은 실행을 아티팩트 버전에
-- 연결해 영속하여, 갤러리(/artifacts) 상세·패널 재방문 시 최근 실행 결과를 복원한다.
-- (감사 로그 audit_logs.artifact_execute 는 메타만 — 본문 미저장, 그대로 유지.)
--
-- 저장 정책: 인증 사용자가 본인 코드 아티팩트를 실행할 때 자동 저장, 아티팩트별 최근 N건
-- 유지(초과분 애플리케이션에서 prune). stdout/stderr 는 저장용으로 별도 캡(config).
-- artifacts 와 동일하게 느슨한 session_id(TEXT) — FK 없이 앱/스윕이 정리(2단계 배포 관행).
-- 멱등(IF NOT EXISTS). 수동 적용(cli.ts migrate).

CREATE TABLE IF NOT EXISTS artifact_executions (
    id           BIGSERIAL PRIMARY KEY,
    session_id   TEXT NOT NULL,
    artifact_id  VARCHAR(80) NOT NULL,
    version      INTEGER NOT NULL,
    user_id      TEXT,
    runtime      VARCHAR(20) NOT NULL,
    stdout       TEXT NOT NULL DEFAULT '',
    stderr       TEXT NOT NULL DEFAULT '',
    exit_code    INTEGER,
    duration_ms  INTEGER NOT NULL DEFAULT 0,
    timed_out    BOOLEAN NOT NULL DEFAULT false,
    truncated    BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 조회: 특정 아티팩트의 최근 실행 이력 (session_id + artifact_id, 최신순)
CREATE INDEX IF NOT EXISTS idx_artifact_exec_lookup
    ON artifact_executions(session_id, artifact_id, created_at DESC);
-- 스윕: TTL 정리용 (오래된 실행 전역 삭제)
CREATE INDEX IF NOT EXISTS idx_artifact_exec_created
    ON artifact_executions(created_at);
