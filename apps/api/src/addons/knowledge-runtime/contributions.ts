/**
 * knowledge-runtime add-on 이 Base 레지스트리에 기여하는 선언 — 감사 action.
 * 순수 데이터다(다른 앱 모듈을 import 하지 않는다 — 감사 레지스트리가 모듈 로드 때 읽는다).
 *
 * @module addons/knowledge-runtime/contributions
 */
import type { AddonContribution } from '../../addon-host/contributions';

/** 수집 작업 취소(사용자·관리자) — audit_logs 에 쌓이는 값이라 이름을 바꾸지 않는다 */
export const KNOWLEDGE_JOB_CANCELLED_AUDIT_ACTION = 'knowledge.job_cancelled';

declare module '../../config/audit-actions' {
    interface AddonAuditActions {
        [KNOWLEDGE_JOB_CANCELLED_AUDIT_ACTION]: null;
    }
}

export const knowledgeContribution: AddonContribution = {
    auditActions: { [KNOWLEDGE_JOB_CANCELLED_AUDIT_ACTION]: null },
};
