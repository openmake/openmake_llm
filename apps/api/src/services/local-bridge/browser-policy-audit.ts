/**
 * 기기가 정책으로 막은 브라우저 호출의 감사 기록 (2026-10-06).
 *
 * 로컬 실행 작업이 "목록 밖 사이트에 승인 없이 입력하지 않았다"를 감사 기록 표본으로 확인할 수 있게, 기기(Companion·CLI)가
 * 사이트 정책·사용자 제어로 거절한 호출을 audit_logs 에 별도 사건으로 남긴다. 조회: GET /api/audit?action=local_bridge.browser_policy_block
 *
 * - 근거는 기기 결과의 표식(policyBlock, 코어 BrowserPolicyBlock). 표식 없이 userControl 만 실은 기기(#1165)는 user_control 로 본다.
 *   표식이 둘 다 없는 구버전 기기는 종전대로 남기지 않는다(오류 문구를 해석하지 않는다).
 * - 주소 전체·입력 내용은 싣지 않는다 — 호스트와 동작 종류만. 기기가 보낸 값이라 종류는 허용 목록으로, 문자열은 길이로 자른다.
 * - 한 호출에 한 건(쿼리 하나). 기록 실패는 도구 결과를 막지 않는다(fail-open).
 */
import { getAuditService } from '../AuditService';
import { createLogger } from '../../utils/logger';
import type { BridgeResult } from './registry';

const logger = createLogger('BrowserPolicyAudit');

export const BROWSER_POLICY_BLOCK_AUDIT_ACTION = 'local_bridge.browser_policy_block';
/** 사건의 resource_type — 작업 단위로 모아 본다(resourceId = 작업 id) */
const AUDIT_RESOURCE_TYPE = 'agent_task';
/** 기기가 보낼 수 있는 거절 종류(코어 BrowserPolicyBlockKind) — 그 밖의 값은 믿지 않는다 */
const POLICY_BLOCK_KINDS: ReadonlySet<string> = new Set(['site_off_list', 'site_denied', 'blocked_url', 'user_control', 'upload_unapproved', 'upload_rejected']);
const USER_CONTROL_KIND = 'user_control';
/** 호스트 이름 길이 상한 — DNS 이름 최대 길이 */
const HOST_MAX_CHARS = 253;
/** 동작 종류 길이 상한 — 액션 이름(goto·smartFill …)보다 넉넉하게 */
const ACTION_TYPE_MAX_CHARS = 64;

export interface BrowserPolicyBlockAuditDetails {
    taskId: string;
    deviceId: string | null;
    host: string | null;
    actionType: string | null;
    kind: string;
}

function clipped(v: unknown, max: number): string | null {
    return typeof v === 'string' && v !== '' ? v.slice(0, max) : null;
}

/** PURE: 기기 결과 → 감사 기록 내용. 막은 호출이 아니거나 표식을 믿을 수 없으면 null. */
export function browserPolicyBlockDetails(r: BridgeResult, taskId: string, deviceId: string | null): BrowserPolicyBlockAuditDetails | null {
    const block = r.policyBlock && typeof r.policyBlock === 'object' ? r.policyBlock : null;
    const kind = block ? block.kind : r.userControl === true ? USER_CONTROL_KIND : null;
    if (typeof kind !== 'string' || !POLICY_BLOCK_KINDS.has(kind)) return null;
    return {
        taskId,
        deviceId,
        host: clipped(block?.host, HOST_MAX_CHARS),
        actionType: clipped(block?.action, ACTION_TYPE_MAX_CHARS),
        kind,
    };
}

/** 막은 호출이면 감사 기록 한 건을 남긴다. 실패는 로그만 남기고 삼킨다. */
export async function auditBrowserPolicyBlock(r: BridgeResult, ctx: { taskId: string; userId: string; deviceId: string | null }): Promise<void> {
    const details = browserPolicyBlockDetails(r, ctx.taskId, ctx.deviceId);
    if (!details) return;
    try {
        await getAuditService().logAudit({
            action: BROWSER_POLICY_BLOCK_AUDIT_ACTION,
            userId: ctx.userId,
            resourceType: AUDIT_RESOURCE_TYPE,
            resourceId: ctx.taskId,
            details: { ...details },
        });
    } catch (e) {
        logger.warn(`[${ctx.taskId}] 브라우저 정책 차단 감사 기록 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
}
