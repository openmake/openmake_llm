-- Add-on 상태 모델 확장 (Base·Add-on 통합 P01, 2026-09-23) — 관리자 의도와 부팅 결과의 분리
--
-- 종전 `state` 하나에 관리자 의도(enabled/disabled)와 부팅 결과(failed)가 섞여, failed 행만 보고는
-- "관리자가 켜 두었는데 부팅이 실패했는지" 를 알 수 없었다. 확장 전용(expand-first) — `state` 는 호환 응답용으로 유지한다.
--   desired_state     : 관리자의 사용 의도 (enabled | disabled). 부팅 실패는 이 값을 바꾸지 않는다.
--   state_revision    : 상태 변경마다 증가 — 실행 승인(handle)이 승인 후의 정책 변경을 탐지한다.
--   last_failure_code : 마지막 부팅 실패 분류 (migration_failed | runtime_failed | version_mismatch | needs_retry …)
--
-- 초기 변환(계획서 7.2): enabled→enabled, disabled/installed→disabled, failed→disabled + needs_retry.
-- 과거 failed 의 의도를 추측해 자동 재활성화하지 않는다.

ALTER TABLE addon_installations ADD COLUMN IF NOT EXISTS desired_state VARCHAR(20) NOT NULL DEFAULT 'enabled';
ALTER TABLE addon_installations ADD COLUMN IF NOT EXISTS state_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE addon_installations ADD COLUMN IF NOT EXISTS last_failure_code VARCHAR(40);

UPDATE addon_installations
   SET desired_state = CASE WHEN state = 'enabled' THEN 'enabled' ELSE 'disabled' END,
       last_failure_code = CASE WHEN state = 'failed' THEN 'needs_retry' ELSE last_failure_code END
 WHERE state_revision = 1 AND desired_state = 'enabled';
