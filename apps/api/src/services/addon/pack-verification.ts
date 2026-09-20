/**
 * 팩 검증 결과 조회 — "이 팩은 이 모델에서 검증됨" (오픈웨이트 전환 S3).
 *
 * 출처는 `eval_runs` 의 팩 검증 실행(`npm run eval:packs`, runner=`pack`, variant=`addon:<id>`)이다. (팩, 모델) 마다 **최신 실행**만 보고,
 * 통과율이 하한 이상이면 verified. 기록이 없는 팩은 빈 목록 — "검증 안 됨" 이지 "실패" 가 아니다.
 *
 * @module services/addon/pack-verification
 */
import type { Pool } from 'pg';
import { PACK_EVAL_RUNNER, packVerifyMinPassRate } from '../../config/pack-verification';
import { EvalRunRepository } from '../../data/repositories/eval-run-repository';
import { createLogger } from '../../utils/logger';

const logger = createLogger('PackVerification');
const ADDON_TAG_PREFIX = 'addon:';

export interface PackModelVerification {
    model: string;
    passRate: number;
    totalCases: number;
    verified: boolean;
    evaluatedAt: string;
}

/** PURE: 최신 실행 행 → add-on id 별 검증 목록 (verified 먼저, 그다음 모델 이름순) */
export function groupPackVerifications(
    rows: ReadonlyArray<{ variant: string; model: string; pass_rate: number; total_cases: number; completed_at: string }>,
    minPassRate: number,
): Map<string, PackModelVerification[]> {
    const out = new Map<string, PackModelVerification[]>();
    for (const r of rows) {
        if (!r.variant.startsWith(ADDON_TAG_PREFIX) || r.total_cases <= 0) continue;
        const id = r.variant.slice(ADDON_TAG_PREFIX.length);
        const passRate = Number(r.pass_rate);
        out.set(id, [...(out.get(id) ?? []), {
            model: r.model, passRate, totalCases: r.total_cases, verified: passRate >= minPassRate, evaluatedAt: new Date(r.completed_at).toISOString(),
        }]);
    }
    for (const list of out.values()) list.sort((a, b) => Number(b.verified) - Number(a.verified) || a.model.localeCompare(b.model));
    return out;
}

/** 조회 실패는 빈 결과 — 관리 화면의 나머지를 막지 않는다(로그로 알린다) */
export async function loadPackVerifications(pool: Pool): Promise<Map<string, PackModelVerification[]>> {
    try {
        return groupPackVerifications(await new EvalRunRepository(pool).latestByVariantAndModel(PACK_EVAL_RUNNER), packVerifyMinPassRate());
    } catch (err) {
        logger.warn(`팩 검증 이력 조회 실패 — 빈 목록으로 계속: ${err instanceof Error ? err.message : String(err)}`);
        return new Map();
    }
}
