-- 125: 승인 대기 행에 위험 등급 (로드맵 2단계 Policy and Approval, 2026-09-16)
--
-- 승인 여부가 도구 이름 목록으로 정해져 승인함이 "왜 승인이 필요한지"를 보여 줄 수 없었다.
-- config/tool-policy.ts 의 등급표(read·write·destructive·exec·network·external·control)로 판정을
-- 옮기고, 요청 시점 등급을 행에 남긴다. 구 행은 NULL — 조회 시 같은 표로 재분류한다.
ALTER TABLE agent_task_approvals ADD COLUMN IF NOT EXISTS risk_class TEXT;
COMMENT ON COLUMN agent_task_approvals.risk_class IS
    '요청 시점 위험 등급(config/tool-policy): read|write|destructive|exec|network|external|control. 구 행은 NULL (125)';
