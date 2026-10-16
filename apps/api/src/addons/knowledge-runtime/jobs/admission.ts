/**
 * claim 뒤 작업별 실행 판정 — 접수 주체(actor)를 다시 확인한다(설계 §5 C4 "claim 시 재검사").
 * system(정리·평가)과 004 이전 행(actor NULL)은 사용권을 보지 않고 실행한다 — add-on 단위 게이트는 tick 이 이미 봤다.
 * 사용자·조직 작업은 라우트 게이트와 같은 판정(`checkUserEntitlement` — 상태 + 조직 사용권)을 다시 한다.
 *
 * @module addons/knowledge-runtime/jobs/admission
 */
import {
    checkUserEntitlement, readAddonRunVerdict, type AddonRunVerdict, type EntitlementVerdict,
} from '../../../runtime-ports/addon-admission';
import { KNOWLEDGE_ADDON_ID } from '../constants';
import type { JobActorKind } from './job-schema';

/** 판정 포트 — worker 가 deps 로 받는다(테스트가 주입). 기본은 runtime-ports/addon-admission */
export interface AdmissionPort {
    readRunVerdict(addonId: string): Promise<AddonRunVerdict>;
    checkUserEntitlement(addonId: string, userId: string): Promise<EntitlementVerdict>;
}

export const defaultAdmissionPort: AdmissionPort = {
    readRunVerdict: (addonId) => readAddonRunVerdict(addonId),
    checkUserEntitlement: (addonId, userId) => checkUserEntitlement(addonId, userId),
};

/** run: 실행 · defer: 보류(나중에 다시) · reject: 최종 거절 */
export type JobAdmission = 'run' | 'defer' | 'reject';

/** 사용권 판정 → 작업 처리. 꺼짐·실패·확인 불가는 버리지 않고 보류한다(관리자가 다시 켜면 이어서 처리) */
const VERDICT_ADMISSION: Readonly<Record<EntitlementVerdict, JobAdmission>> = {
    ok: 'run',
    'not-entitled': 'reject',
    disabled: 'defer',
    failed: 'defer',
    'state-unknown': 'defer',
};

export function admissionForVerdict(verdict: EntitlementVerdict): JobAdmission {
    return VERDICT_ADMISSION[verdict];
}

export interface AdmissionDecision {
    admission: JobAdmission;
    /** 로그·last_error 에 남기는 판정 이름 */
    verdict: EntitlementVerdict | 'system' | 'missing-user';
}

export async function admitJob(
    job: { actor_kind?: JobActorKind | null; actor_user_id?: string | null },
    port: AdmissionPort,
): Promise<AdmissionDecision> {
    const kind = job.actor_kind ?? 'system'; // 004 이전 행(NULL)은 시스템 작업으로 본다
    if (kind === 'system') return { admission: 'run', verdict: 'system' };
    if (!job.actor_user_id) return { admission: 'reject', verdict: 'missing-user' };
    const verdict = await port.checkUserEntitlement(KNOWLEDGE_ADDON_ID, job.actor_user_id);
    return { admission: admissionForVerdict(verdict), verdict };
}
