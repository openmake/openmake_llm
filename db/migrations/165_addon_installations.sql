-- Add-on 설치·상태 모델 (S3) + 팩 스킬의 소유 add-on (2026-09-19)
--
-- 상태는 4개뿐이다: installed(설치만) · enabled(사용) · disabled(관리자가 끔) · failed(부팅 실패).
-- 내장 add-on 도 같은 표에 올라간다 — 내장/설치형이 한 계약을 쓰기 위한 1단계(arch_plan S3).
-- ⚠️ 켜고 끄기의 authority 는 이 표이고, env ADDON_BUILTIN_DISABLED 는 그 위의 비상 override 다.

CREATE TABLE IF NOT EXISTS addon_installations (
    addon_id        VARCHAR(120) PRIMARY KEY,
    name            VARCHAR(160) NOT NULL,
    version         VARCHAR(40)  NOT NULL,
    kind            VARCHAR(20)  NOT NULL DEFAULT 'content',
    -- 설치 소스: builtin | git | zip | local | marketplace
    source          VARCHAR(20)  NOT NULL DEFAULT 'builtin',
    -- 상태: installed | enabled | disabled | failed
    state           VARCHAR(20)  NOT NULL DEFAULT 'enabled',
    failure_reason  TEXT,
    -- 유료 팩 식별자 (매니페스트 entitlement.sku) — 조직 정책 allowlist 와 짝
    entitlement_sku VARCHAR(120),
    installed_at    TIMESTAMPTZ  DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_addon_installations_state ON addon_installations(state);

-- 스킬의 소유 add-on — entitlement 로 주입을 거를 때 쓴다(팩 스킬만 채워진다).
ALTER TABLE agent_skills ADD COLUMN IF NOT EXISTS addon_id VARCHAR(120);
CREATE INDEX IF NOT EXISTS idx_agent_skills_addon_id ON agent_skills(addon_id);
