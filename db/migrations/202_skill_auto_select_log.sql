-- 202: 스킬 자동 선택(load_skill) 효과 측정 로그
--
-- SKILL_AUTO_SELECT_ENABLED=true 일 때 load_skill 도구에 스킬 카탈로그를 실어 모델에 노출한다.
-- 지금까지는 실제 호출(skill_audit_log.tool_called='load_skill')만 남아서, 몇 번 노출됐는지·
-- 이름을 틀려 못 찾은 호출이 몇 번인지 알 수 없었다. 턴 단위 이벤트를 따로 남긴다:
--   offered  카탈로그를 실은 load_skill 이 도구 목록에 들어감 (catalog_size = 카탈로그 스킬 수)
--   called   모델이 load_skill 을 호출해 1개 이상 찾음 (requested·matched = 요청·매칭 이름 수)
--   miss     모델이 load_skill 을 호출했지만 하나도 못 찾음
-- 원문 이름·인자는 저장하지 않는다. 기록은 fail-open(addons/skill-runtime/skill-usage-log.ts). 멱등.

CREATE TABLE IF NOT EXISTS skill_auto_select_log (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id       TEXT NOT NULL,
    event         TEXT NOT NULL CHECK (event IN ('offered', 'called', 'miss')),
    catalog_size  INT,
    requested     INT,
    matched       INT
);
CREATE INDEX IF NOT EXISTS idx_skill_auto_select_ts ON skill_auto_select_log (ts DESC);

COMMENT ON TABLE skill_auto_select_log IS
    'Skill auto-select (load_skill) funnel per turn: offered / called / miss. See addons/skill-runtime/skill-usage-log.ts.';
