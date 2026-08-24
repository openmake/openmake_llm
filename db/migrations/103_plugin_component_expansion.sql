-- Migration 103 — 확장 구성요소 확대 (설치 시 적응 Phase 2, 2026-08-24)
--
-- Phase 1 은 외부 플러그인의 skills/ 와 mcpServers 만 설치하고 commands/·agents/ 는
-- "미지원"으로 리포트만 했다. Phase 2 는 이 둘을 등가물로 변환해 실제로 설치한다:
--   commands/<name>.md → 스킬 (openmake 는 슬래시 명령이 스킬 매칭)
--   agents/<name>.md   → Custom Agent (user_agents.system_prompt)
-- 또한 스킬에 딸린 scripts/·references/ 파일을 보존해 "본문이 참조하는데 파일이 없는"
-- 상태를 없앤다.
--
-- 1) user_agents.extension_id — 확장 단위 제거/업데이트 시 함께 정리 (agent_skills·
--    mcp_servers 의 extension_id 와 동형. ON DELETE SET NULL = 링크만 해제).
-- 2) skill_assets — 스킬 번들 파일 (SKILL.md 와 같은 디렉토리의 scripts/·references/·
--    assets/). 원본 바이트를 BYTEA 로 보존하며, 목록 안내와 load_skill(asset_paths)
--    열람에 쓰인다. 크기·개수 상한은 서비스 레이어가 강제.
--    ⚠️ 현재 ingest 는 **텍스트 파일만** 저장한다 — GitFetcher 가 UTF-8 문자열만 주므로
--    바이너리(이미지·PDF·폰트)는 왕복에서 깨진다. 컬럼이 BYTEA 인 것은 향후 fetcher 에
--    바이트 모드를 추가하면 스키마 변경 없이 바이너리를 담기 위함이다.
--
-- 멱등 (IF NOT EXISTS + DO/EXCEPTION 제약 가드).

-- ── 1) Custom Agent ↔ 확장 링크 ───────────────────────────────────────────────
DO $$
BEGIN
    ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS extension_id TEXT;
    BEGIN
        ALTER TABLE user_agents
            ADD CONSTRAINT fk_user_agents_extension
            FOREIGN KEY (extension_id) REFERENCES user_extensions(id) ON DELETE SET NULL;
    EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN undefined_table THEN NULL;   -- user_extensions 미생성 환경 (093 미적용) 대비
    END;
    CREATE INDEX IF NOT EXISTS idx_user_agents_extension ON user_agents(extension_id)
        WHERE extension_id IS NOT NULL;
EXCEPTION
    WHEN undefined_table THEN NULL;       -- user_agents 미생성 환경 대비 (graceful)
END $$;

-- ⚠️ 확장 유래 Custom Agent 는 **즉시 활성**으로 만든다. user_agents 의 is_active=FALSE 는
-- soft-delete 계약이라(user-agent-repository 주석) draft 표현에 재사용할 수 없고, 에이전트는
-- 스킬/MCP 와 달리 실행 권한 없이 사용자가 명시 선택할 때만 적용되는 페르소나라 승인 게이트가
-- 필요 없다. 대신 이름 충돌은 UNIQUE(user_id, name) 때문에 서비스가 prefix/suffix 로 회피한다.

-- ── 2) 스킬 번들 파일 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_assets (
    id           TEXT PRIMARY KEY,                        -- 'skill-asset-<uuid>'
    skill_id     TEXT NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
    rel_path     TEXT NOT NULL,                           -- SKILL.md 기준 상대 경로 (예: 'scripts/check.py')
    content_type TEXT NOT NULL DEFAULT 'text/plain',
    size_bytes   INTEGER NOT NULL,
    content      BYTEA NOT NULL,                          -- 원본 바이트 (텍스트/바이너리 공통)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 같은 스킬 안에서 상대 경로는 유일 (재설치 시 UPSERT 키)
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_assets_path ON skill_assets(skill_id, rel_path);
CREATE INDEX IF NOT EXISTS idx_skill_assets_skill ON skill_assets(skill_id);
