-- 207: 확장 카탈로그 원본 동기화·자격증명·이름 별칭 (마켓플레이스 남은 개발계획 v3.7 M4·M5)
--
-- 모든 컬럼은 NULL 허용이고 NULL = 종전 동작이다 — 새 동작은 전부 opt-in.
--  * alias                : M5 이름 설치(`플러그인@별칭`)의 카탈로그 별칭. 원본마다 고유. NULL = 스냅샷 name 으로 해석
--  * credential_encrypted : 원본 접근 토큰(관리자 입력 시에만, token-crypto AES-256-GCM). 응답·로그에 내보내지 않는다(write-only)
--  * source_subpath       : 저장소 안 카탈로그 루트(하위 경로). NULL = 저장소 루트
--  * index_url            : M6 정적 색인 주소(예약 — 이 마이그레이션에선 쓰지 않는다)
--  * sync_status          : 마지막 동기화 결과 ok | error | rate_limited. NULL = 기록 없음(종전 행)
--  * last_sync_error      : 마지막 실패 사유(자격증명 마스킹 후 저장)
--  * last_sync_attempt_at : 마지막 동기화 시도 시각(성공 시각은 기존 last_synced_at)
--
-- 멱등(ADD COLUMN IF NOT EXISTS · 제약은 duplicate_object 무시).
ALTER TABLE extension_catalog_sources ADD COLUMN IF NOT EXISTS alias TEXT NULL;
ALTER TABLE extension_catalog_sources ADD COLUMN IF NOT EXISTS credential_encrypted TEXT NULL;
ALTER TABLE extension_catalog_sources ADD COLUMN IF NOT EXISTS source_subpath TEXT NULL;
ALTER TABLE extension_catalog_sources ADD COLUMN IF NOT EXISTS index_url TEXT NULL;
ALTER TABLE extension_catalog_sources ADD COLUMN IF NOT EXISTS sync_status TEXT NULL;
ALTER TABLE extension_catalog_sources ADD COLUMN IF NOT EXISTS last_sync_error TEXT NULL;
ALTER TABLE extension_catalog_sources ADD COLUMN IF NOT EXISTS last_sync_attempt_at TIMESTAMPTZ NULL;

DO $$ BEGIN
    ALTER TABLE extension_catalog_sources ADD CONSTRAINT extension_catalog_sources_alias_key UNIQUE (alias);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE extension_catalog_sources ADD CONSTRAINT extension_catalog_sources_sync_status_check
        CHECK (sync_status IS NULL OR sync_status IN ('ok', 'error', 'rate_limited'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN extension_catalog_sources.credential_encrypted IS
    '원본 접근 토큰(암호화, write-only) — 동기화에만 쓴다. API 응답·로그 노출 금지';
