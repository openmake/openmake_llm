/**
 * 팩 검증("이 팩은 이 모델에서 검증됨") 의 공용 값 — 러너(evaluation/run-pack-evaluation)와 조회(관리자 add-on 목록)가 함께 본다.
 *
 * @module config/pack-verification
 */

/** `eval_runs.runner` 값 — 팩 검증 실행 */
export const PACK_EVAL_RUNNER = 'pack';

/** 이 통과율 이상이어야 "검증됨" 으로 표시한다 (env `OMK_EVAL_PACK_MIN_PASS_RATE`) */
export function packVerifyMinPassRate(): number {
    const v = Number(process.env.OMK_EVAL_PACK_MIN_PASS_RATE);
    return process.env.OMK_EVAL_PACK_MIN_PASS_RATE && Number.isFinite(v) ? v : 0.8;
}
