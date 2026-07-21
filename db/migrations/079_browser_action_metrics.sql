-- Migration 079 — Agent Task 브라우저 액션 계측 (Computer Use Stage 0)
--
-- browser 도구 호출마다 액션 결과를 집계해 영속화한다. 목적은 두 가지 의사결정 게이트:
--   ① 방금 배포한 a11y 폴백(snapshot/smartClick/smartFill)이 실제로 발동·구원하는가
--      (배포 실효 검증)
--   ② DOM/a11y 셀렉터 경로의 한계(canvas/비표준 UI = selector_fail>0 AND a11y_fail>0)가
--      실사용에서 얼마나 발생하는가 → State block(경로 A) vs Vision+좌표클릭(경로 B) 실수요 판정.
--
-- model_pool_metrics(031) 와 동일 성격: browser 호출당 1행(빈도 낮음), PII 없음(수치만).
-- 주-단위 집계로 Stage 1 분기를 데이터로 결정한다(measure-first).

CREATE TABLE IF NOT EXISTS browser_action_metrics (
    id               SERIAL PRIMARY KEY,
    task_id          TEXT NOT NULL,
    user_id          TEXT NOT NULL,
    total_actions    INTEGER NOT NULL,
    selector_actions INTEGER NOT NULL,  -- CSS 셀렉터 액션(click/fill) 수
    selector_fail    INTEGER NOT NULL,  -- 그중 실패 수 → CSS 실패율 분자
    a11y_attempt     INTEGER NOT NULL,  -- a11y 폴백(snapshot/smartClick/smartFill) 사용 수
    a11y_fail        INTEGER NOT NULL,  -- smartClick/smartFill 실패 수
    overall_ok       BOOLEAN NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_browser_action_metrics_created ON browser_action_metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_browser_action_metrics_task ON browser_action_metrics(task_id);
