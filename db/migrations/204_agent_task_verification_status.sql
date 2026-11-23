-- 204: 완료 검증 결과 4상태 (하네스 P1-4)
--
-- 완료 관문의 검증(산출물 검사·workspace 테스트 게이트·goal judge)은 fail-open 이라, "러너가 없어 안 돌렸다"·
-- "인프라 오류로 알 수 없다"·"통과했다" 가 모두 같은 completed 로 남았다(테스트 러너가 없으면 ran:false, ok:true).
-- 종합 결과를 한 컬럼에 남겨 집계·화면이 구분할 수 있게 한다.
--
--  * verification_status : passed | not_run | failed | inconclusive. 기존 행·미완료 행은 NULL.
--    failed = 검증이 실패했고 재시도 상한 안에 고치지 못함. AGENT_TASK_VERIFY_STRICT=true 면 이 경우 작업이
--    completed 가 아니라 failed(error=verification_failed)로 끝난다.
--
-- 기존 행·기존 동작 무영향(NULL 허용).
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS verification_status TEXT;

DO $$ BEGIN
    ALTER TABLE agent_tasks ADD CONSTRAINT agent_tasks_verification_status_check
        CHECK (verification_status IS NULL OR verification_status IN ('passed', 'not_run', 'failed', 'inconclusive'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN agent_tasks.verification_status IS
    '완료 검증 종합: passed | not_run(대상·러너 없음) | failed(재시도 상한 안에 못 고침) | inconclusive(인프라 오류·판정 실패). 기존 행은 NULL (204)';
