/**
 * 내부 전용 실행의 감사 기록 (Companion P1-5) — 쓰지 않은 외부 모델과 목록에서 뺀 외부 도구를 남긴다.
 * 차단한 것이 없으면 기록하지 않는다. 기록 실패가 작업을 막지 않는다(fail-open).
 *
 * @module services/agent-task/internal-only-audit
 */
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskInternalOnly');

export const INTERNAL_ONLY_AUDIT_ACTION = 'agent_task.internal_only_enforced';
/** 감사 기록에 싣는 도구 이름 수 상한 — 외부 MCP 카탈로그가 크면 수백 개가 될 수 있다 */
const AUDIT_TOOL_NAMES_MAX = 50;

export async function auditInternalOnly(p: { taskId: string; userId: string; blockedModel?: string; removedTools: readonly string[] }): Promise<void> {
    if (!p.blockedModel && p.removedTools.length === 0) return;
    try {
        const { getAuditService } = await import('../AuditService');
        await getAuditService().logAudit({
            action: INTERNAL_ONLY_AUDIT_ACTION,
            userId: p.userId,
            resourceType: 'agent_task',
            resourceId: p.taskId,
            details: {
                ...(p.blockedModel ? { blockedModel: p.blockedModel } : {}),
                removedToolCount: p.removedTools.length,
                removedTools: p.removedTools.slice(0, AUDIT_TOOL_NAMES_MAX),
            },
        });
    } catch (e) {
        logger.warn(`[${p.taskId}] 내부 전용 감사 기록 실패(무시): ${e instanceof Error ? e.message : e}`);
    }
}
