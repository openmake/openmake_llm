/**
 * 채팅 내부 전용 턴 처리 (하네스 P0-2) — 반출 관문(config/egress-policy)이 내부 전용으로 판정한 턴의 모델 교체·고지·감사.
 * 감사 기록엔 걸린 민감도 패턴 이름만 싣고 값·본문은 싣지 않는다. 기록 실패가 채팅을 막지 않는다(fail-open).
 *
 * @module services/chat-service/chat-egress
 */
import { createLogger } from '../../utils/logger';
import { runProviderGate } from './provider-gate';
import { getEgressModelFallbackMessage } from '../../prompts/egress-notices';
import type { EgressDecision } from '../../config/egress-policy';
import type { ProviderRouter, ProviderRouterContext, ResolvedProvider } from '../../providers/provider-router';
import type { SystemEventCallback } from '../chat-service-types';

const logger = createLogger('ChatEgress');

export const CHAT_EGRESS_AUDIT_ACTION = 'chat.egress_internal_only';

type EgressSummary = Pick<EgressDecision, 'reason' | 'sensitivity' | 'matched'>;

/**
 * 내부 전용 턴의 모델 — 외부로 해석됐으면 내부 기본 모델로 다시 해석하고 model_fallback 으로 고지한다(배지·대화 기록은
 * 실제 응답 모델을 싣는다). 내부 모델이면 그대로. 어느 쪽이든 감사 기록을 남긴다.
 */
export async function enforceInternalOnlyModel(
    router: ProviderRouter,
    resolved: ResolvedProvider,
    p: { fallbackModel: string; userId?: string; userRole?: ProviderRouterContext['userRole']; lang?: string; egress: EgressSummary; onSystemEvent?: SystemEventCallback },
): Promise<ResolvedProvider> {
    logger.info(`[Egress] 내부 전용 턴 — 민감도 ${p.egress.sensitivity} (${p.egress.matched.join(', ')})`);
    if (resolved.providerId === 'local-llm') {
        void auditChatEgress({ userId: p.userId, egress: p.egress });
        return resolved;
    }
    const internal = await runProviderGate(router, { fallbackModel: p.fallbackModel, ctx: { userId: p.userId, userRole: p.userRole } });
    logger.info(`[Egress] 내부 전용 — 외부 모델 ${resolved.fullId} → ${internal.fullId}`);
    p.onSystemEvent?.({
        type: 'model_fallback',
        message: getEgressModelFallbackMessage(p.lang),
        metadata: { from: resolved.fullId, to: internal.fullId, reason: 'egress internal-only', code: 'EGRESS_INTERNAL_ONLY' },
    });
    void auditChatEgress({ userId: p.userId, blockedModel: resolved.fullId, egress: p.egress });
    return internal;
}

export async function auditChatEgress(p: { userId?: string; blockedModel?: string; egress: EgressSummary }): Promise<void> {
    try {
        const { getAuditService } = await import('../AuditService');
        await getAuditService().logAudit({
            action: CHAT_EGRESS_AUDIT_ACTION,
            ...(p.userId ? { userId: p.userId } : {}),
            resourceType: 'chat',
            details: {
                reason: p.egress.reason,
                sensitivity: p.egress.sensitivity,
                matched: p.egress.matched,
                ...(p.blockedModel ? { blockedModel: p.blockedModel } : {}),
            },
        });
    } catch (e) {
        logger.warn(`내부 전용 감사 기록 실패(무시): ${e instanceof Error ? e.message : e}`);
    }
}
