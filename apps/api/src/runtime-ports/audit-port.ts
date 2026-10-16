/**
 * Add-on 감사 기록 포트 — add-on 이 `services/AuditService` 를 직접 import 하지 않고 감사 로그를 남기는 문(2026-10-16, C4).
 * action 은 config/audit-actions 레지스트리에 있어야 한다(add-on 은 contributions 의 auditActions 로 기여한다).
 *
 * @module runtime-ports/audit-port
 */
import { getAuditService } from '../services/AuditService';
import type { AuditAction } from '../config/audit-actions';

export interface AddonAuditEntry {
    action: AuditAction;
    userId?: string;
    resourceType: string;
    resourceId: string;
    details?: Record<string, unknown>;
}

export async function recordAddonAudit(entry: AddonAuditEntry): Promise<void> {
    await getAuditService().logAudit(entry);
}
