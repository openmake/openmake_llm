-- Migration 198 — 대화 읽기 전용 공유 + org 공개 범위 (2026-11-09)
--
-- 소유자가 저장된 대화를 미리보고 확인하면 그 시점 사본(snapshot)을 게시한다. 원본 대화를 이어가도 공유본은
-- 바뀌지 않는다(원본 live join 금지). 범위: private(소유자) / authenticated(로그인 사용자) / link(토큰) /
-- org(소유자가 고른 조직 한 곳의 현재 멤버).
--
--   conversation_shares          — 세션당 공유 한 건. 재게시는 revision+1 로 snapshot 교체.
--   conversation_share_previews  — 세션당 서버 보관 미리보기 한 건(15분). 게시는 이 행을 그대로 옮긴다.
--
-- 탈퇴·조직 삭제는 API 밖 삭제와 FK cascade 도 있으므로 DB trigger 가 처리한다:
--   소유자 멤버십 제거(DELETE·PK 변경) → 그 조직 대상 공유를 private 로 영구 전환 + 감사 1행(system)
--   조직 삭제                        → 그 조직 대상 공유 전부 private 전환 + 감사 1행, 연결 해제
-- 재가입해도 다시 공개되지 않는다. 감사 action 문자열은 apps/api/src/config/audit-actions.ts 와 같다.
--
-- additive 만 — 새 표·함수·trigger. 기존 표 열·제약은 바꾸지 않는다. 멱등(IF NOT EXISTS · OR REPLACE · DROP TRIGGER IF EXISTS).

CREATE TABLE IF NOT EXISTS conversation_shares (
    share_id             TEXT PRIMARY KEY,
    session_id           TEXT NOT NULL UNIQUE REFERENCES conversation_sessions(id) ON DELETE CASCADE,
    owner_user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visibility           TEXT NOT NULL DEFAULT 'private'
                         CHECK (visibility IN ('private', 'authenticated', 'link', 'org')),
    -- 조직 삭제 BEFORE trigger 가 먼저 연결을 끊으므로 RESTRICT 는 trigger 누락을 드러내는 안전망이다.
    org_id               TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
    -- link 전용 난수(24바이트 base64url). 로그·감사·조회 응답에 싣지 않는다.
    share_token          TEXT,
    snapshot             JSONB NOT NULL,
    snapshot_captured_at TIMESTAMPTZ NOT NULL,
    revision             BIGINT NOT NULL DEFAULT 1,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT conversation_shares_org_chk CHECK ((visibility = 'org') = (org_id IS NOT NULL)),
    CONSTRAINT conversation_shares_token_chk CHECK ((visibility = 'link') = (share_token IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_conversation_shares_owner ON conversation_shares (owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_shares_org_owner ON conversation_shares (org_id, owner_user_id) WHERE visibility = 'org';

CREATE TABLE IF NOT EXISTS conversation_share_previews (
    preview_id    TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL UNIQUE REFERENCES conversation_sessions(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visibility    TEXT NOT NULL DEFAULT 'private'
                  CHECK (visibility IN ('private', 'authenticated', 'link', 'org')),
    org_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE,
    snapshot      JSONB NOT NULL,
    captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL,
    -- 미리보기를 만들 때의 공유 revision(공유 없음 = 0). 게시 때 다르면 409.
    base_revision BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT conversation_share_previews_org_chk CHECK ((visibility = 'org') = (org_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_conversation_share_previews_expires ON conversation_share_previews (expires_at);

COMMENT ON TABLE conversation_shares IS '대화 읽기 전용 공유 — 게시 시점 snapshot, 세션당 1건, 범위 private|authenticated|link|org (198)';
COMMENT ON TABLE conversation_share_previews IS '대화 공유 서버 보관 미리보기 — 세션당 1건, 확인 후 게시 시 공유로 옮기고 지운다 (198)';

-- 소유자 멤버십 제거 → 그 조직 대상 공유를 private 로. DELETE 와 PK(org_id·user_id) 변경 UPDATE 둘 다.
-- 역할만 바꾸는 UPDATE 는 영향 없다. visibility='org' 조건이라 이미 private 인 행은 다시 감사하지 않는다.
CREATE OR REPLACE FUNCTION conversation_share_on_member_removed() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.org_id = OLD.org_id AND NEW.user_id = OLD.user_id THEN
        RETURN NEW;
    END IF;

    WITH changed AS (
        UPDATE conversation_shares
           SET visibility = 'private', org_id = NULL, share_token = NULL,
               revision = revision + 1, updated_at = NOW()
         WHERE visibility = 'org' AND org_id = OLD.org_id AND owner_user_id = OLD.user_id
     RETURNING share_id, revision
    )
    INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details)
    SELECT 'conversation_share.update', NULL, 'conversation_share', changed.share_id,
           jsonb_build_object(
               'scopeBefore', 'org', 'scopeAfter', 'private', 'orgId', OLD.org_id,
               'revision', changed.revision, 'result', 'changed',
               'reason', 'owner_membership_removed', 'removedUserId', OLD.user_id)
      FROM changed;

    -- 미리보기는 지우지 않는다 — 게시가 멤버십을 다시 검사하고, 여기서 미리보기 행까지 잠그면 게시(미리보기→멤버 순)와
    -- 잠금 순서가 엇갈려 deadlock 고리가 생긴다.
    IF TG_OP = 'UPDATE' THEN
        RETURN NEW;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 조직 삭제 → 그 조직 대상 공유 전부 private 로 바꾸고 연결을 끊는다(이어지는 멤버 cascade 는 이미 private 라 중복 감사 없음).
-- 그 조직 대상 미리보기는 FK ON DELETE CASCADE 로 사라진다.
CREATE OR REPLACE FUNCTION conversation_share_on_organization_deleted() RETURNS trigger AS $$
BEGIN
    WITH changed AS (
        UPDATE conversation_shares
           SET visibility = 'private', org_id = NULL, share_token = NULL,
               revision = revision + 1, updated_at = NOW()
         WHERE visibility = 'org' AND org_id = OLD.id
     RETURNING share_id, revision
    )
    INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details)
    SELECT 'conversation_share.update', NULL, 'conversation_share', changed.share_id,
           jsonb_build_object(
               'scopeBefore', 'org', 'scopeAfter', 'private', 'orgId', OLD.id,
               'revision', changed.revision, 'result', 'changed', 'reason', 'organization_deleted')
      FROM changed;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversation_share_member_removed ON organization_members;
CREATE TRIGGER trg_conversation_share_member_removed
    BEFORE DELETE OR UPDATE OF org_id, user_id ON organization_members
    FOR EACH ROW EXECUTE FUNCTION conversation_share_on_member_removed();

DROP TRIGGER IF EXISTS trg_conversation_share_organization_deleted ON organizations;
CREATE TRIGGER trg_conversation_share_organization_deleted
    BEFORE DELETE ON organizations
    FOR EACH ROW EXECUTE FUNCTION conversation_share_on_organization_deleted();
