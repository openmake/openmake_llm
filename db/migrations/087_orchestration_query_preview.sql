-- ============================================================
-- 087: 오케스트레이션 셰도우에 질의 프리뷰 추가
-- ============================================================
-- Stage 2(086) 는 호출률을 재지만 "어떤 문장에서 모델이 도구를 마다했는지" 를
-- 알 수 없어 description 문구 튜닝의 근거를 만들 수 없다(measure-first 원칙 위배).
-- 의도 매칭 턴에 한해 질의 앞부분만 저장해 미호출 반례를 진단 가능하게 한다.
--
-- 범위 제한:
--   - 앞 80자만 (앱 레이어에서 절단) — 전문 저장 아님
--   - 의도 프리필터 매칭 턴만 적재 (일반 채팅은 애초에 이 테이블에 안 들어옴)
--   - ORCHESTRATION_AUTO_DISPATCH=false 면 적재 자체가 없음
--   - 보존: 프리뷰는 ORCH_PREVIEW_RETENTION_DAYS(기본 30일) 후 NULL 처리 —
--     집계 지표(호출률·재현율)는 행 보존 기간(METRICS_RETENTION_DAYS 90일)까지 유지.
--     즉 문구 튜닝용 텍스트만 먼저 사라지고 통계는 남는다 (data minimization).
--
-- 분석 예시:
--   -- 노출됐으나 모델이 호출하지 않은 질의 (문구 튜닝 반례)
--   SELECT query_preview, tools_exposed FROM orchestration_dispatch_decisions
--    WHERE user_mode='none' AND tool_called IS NULL AND query_preview IS NOT NULL
--    ORDER BY created_at DESC LIMIT 20;

ALTER TABLE orchestration_dispatch_decisions
    ADD COLUMN IF NOT EXISTS query_preview TEXT;

COMMENT ON COLUMN orchestration_dispatch_decisions.query_preview IS
    '의도 매칭 턴의 질의 앞 80자 (description 튜닝 반례 진단용, 기본 30일 후 NULL 처리)';
