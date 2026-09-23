-- 생성 산출물 소유권 레코드 (Base·Add-on 통합 P04, 2026-09-23)
--
-- 종전 /generated 파일은 소유자 없이 공개 정적 root 에 쓰였다(계획서 F16·12.1). 이 표가 소유·세션·크기·MIME·삭제 상태의 SoT 이고
-- 신규 파일은 공개 root 밖(비공개 디렉토리)에 저장돼 인증된 /generated/<name> 핸들러가 이 표로 접근을 판정한다.
-- 백필: 대화 메시지(assistant 본문의 /generated/<name> 링크 → 세션 소유자)와 orchestrator_jobs.result_path(→ user_id)로
-- 소유자가 **확인되는 파일만** legacy_public 으로 등록한다. 근거 없는 파일은 등록하지 않는다 — 삭제하지 않고 핸들러가 격리(403)한다.

CREATE TABLE IF NOT EXISTS generated_artifacts (
    id              BIGSERIAL PRIMARY KEY,
    file_name       VARCHAR(200) NOT NULL UNIQUE,
    -- users.id 는 TEXT. 게스트 생성물은 NULL(소유자를 묶을 신원이 없다 — 종전과 같이 공개, 코드 주석 참고)
    owner_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    session_id      TEXT,
    mime            VARCHAR(120) NOT NULL DEFAULT '',
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    sha256          CHAR(64),
    -- private: 비공개 디렉토리(신규) | legacy_public: 종전 공개 root(백필)
    storage         VARCHAR(20) NOT NULL DEFAULT 'private',
    capability      VARCHAR(40),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_generated_artifacts_owner ON generated_artifacts(owner_user_id, created_at DESC);

-- 백필 ①: 대화 메시지 링크 → 세션 소유자
INSERT INTO generated_artifacts (file_name, owner_user_id, session_id, storage, created_at)
SELECT DISTINCT ON (x.name) x.name, s.user_id, x.session_id, 'legacy_public', x.created_at
  FROM (
        SELECT cm.session_id, cm.created_at, (regexp_matches(cm.content, '/generated/([A-Za-z0-9._-]+)', 'g'))[1] AS name
          FROM conversation_messages cm
         WHERE cm.role = 'assistant' AND cm.content LIKE '%/generated/%'
       ) x
  JOIN conversation_sessions s ON s.id = x.session_id
 WHERE s.user_id IS NOT NULL AND x.name NOT LIKE 'reports/%'
 ORDER BY x.name, x.created_at ASC
ON CONFLICT (file_name) DO NOTHING;

-- 백필 ②: 영상 job 저장본 → job 소유자
INSERT INTO generated_artifacts (file_name, owner_user_id, session_id, storage, capability, created_at)
SELECT regexp_replace(j.result_path, '^/generated/', ''), j.user_id, j.session_id, 'legacy_public', j.capability, j.created_at
  FROM orchestrator_jobs j
 WHERE j.result_path IS NOT NULL AND j.result_path ~ '^/generated/[A-Za-z0-9._-]+$'
ON CONFLICT (file_name) DO NOTHING;
