-- Migration 047 — Artifact Publications (Claude Code Artifacts 동등 공유 모델)
-- 2026-06-23: 채팅 내 산출물(artifacts)을 독립 뷰어 URL 로 publish + 공유.
--
-- Claude Code 의 "share session output as artifacts" 모델을 자체호스팅 단일 인스턴스에 매핑:
--   - 'private'       : 소유자 본인만 (기본)
--   - 'authenticated' : 인증된 모든 사용자에게 공개 (CC 의 "조직 전체 공유" 동등)
--   - 'link'          : 불추측 share_token 보유자에게 공개 (CC 의 "파일 공유" 동등, 비인증 허용)
--
-- 논리적 artifact(= session_id + artifact_id 버전 묶음) 당 publication 1건.
-- shared_version: NULL = 항상 최신 버전 노출, N = 특정 버전 고정 노출(CC 의 "공유 버전 선택").

CREATE TABLE IF NOT EXISTS artifact_publications (
    publication_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 논리적 artifact 참조 (artifacts 테이블의 버전 묶음). 타입은 artifacts 와 일치.
    session_id      TEXT NOT NULL,
    artifact_id     VARCHAR(80) NOT NULL,
    -- 작성자(소유자) — gallery / 작성자 표기 / 소유권 검증.
    owner_user_id   TEXT NOT NULL,
    -- private | authenticated | link
    visibility      VARCHAR(20) NOT NULL DEFAULT 'private',
    -- visibility='link' 일 때 URL 에 부여되는 불추측 토큰 (app 에서 crypto 로 생성).
    share_token     VARCHAR(64),
    -- 노출 버전 고정 (NULL = 항상 최신).
    shared_version  INTEGER,
    -- 브라우저 탭 아이콘용 이모지 (CC 의 emoji 동등).
    icon            VARCHAR(16),
    -- publish 시점 제목 snapshot (미지정 시 artifact 최신 title 사용).
    title           VARCHAR(200),
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    -- 논리적 artifact 당 publication 1건.
    CONSTRAINT artifact_pub_session_artifact_uniq UNIQUE (session_id, artifact_id)
);

-- FK 는 graceful 패턴 ([[project_migration_graceful_owner]]) — owner mismatch 대응.
DO $$
BEGIN
    BEGIN
        ALTER TABLE artifact_publications
            ADD CONSTRAINT artifact_pub_session_fk
            FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'artifact_pub_session_fk skip: %', SQLERRM;
    END;
    BEGIN
        ALTER TABLE artifact_publications
            ADD CONSTRAINT artifact_pub_owner_fk
            FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'artifact_pub_owner_fk skip: %', SQLERRM;
    END;
END $$;

-- gallery: 소유자의 publication 최근순
CREATE INDEX IF NOT EXISTS idx_artifact_pub_owner
    ON artifact_publications(owner_user_id, updated_at DESC);

-- link 뷰어: share_token 으로 단건 조회 (부분 인덱스 — link 만)
CREATE INDEX IF NOT EXISTS idx_artifact_pub_token
    ON artifact_publications(share_token) WHERE share_token IS NOT NULL;
