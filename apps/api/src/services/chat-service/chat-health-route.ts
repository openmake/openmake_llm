/**
 * 채팅 모델 상태 기반 라우팅 (하네스 P2-7) — 확정된 모델이 최근 실측상 비정상이면 대체 후보 중 건강한 모델로
 * 단가 → 지연 순으로 다시 해석하고 model_fallback(code MODEL_UNHEALTHY)으로 고지한다(규칙은 config/model-health-routing).
 * 후보는 외부 모델 정책(provider-gate)을 통과해야 하며, 통과하는 후보가 없으면 원래 모델 그대로 간다(fail-open).
 *
 * @module services/chat-service/chat-health-route
 */
import { createLogger } from '../../utils/logger';
import { runProviderGate } from './provider-gate';
import { MODEL_HEALTH_ROUTING, judgeHealth, rankAlternates, type RouteCandidate } from '../../config/model-health-routing';
import { getModelHealth } from '../routing/model-health';
import { resolveRate } from '../cost/cost-ledger-service';
import { getModelUnhealthyFallbackMessage } from '../../prompts/routing-notices';
import type { ProviderRouter, ProviderRouterContext, ResolvedProvider } from '../../providers/provider-router';
import type { SystemEventCallback } from '../chat-service-types';

const logger = createLogger('ChatHealthRoute');

const LOCAL = 'local-llm';

/** fullId → (provider, 계측 키 model, 단가 kind). 로컬 fullId 는 'local-llm:<model>' 또는 접두 없는 모델 id. */
function parse(fullId: string): { providerId: string; model: string } {
    const i = fullId.indexOf(':');
    return i > 0 ? { providerId: fullId.slice(0, i), model: fullId.slice(i + 1) } : { providerId: LOCAL, model: fullId };
}

async function unitCost(fullId: string): Promise<number> {
    const { providerId, model } = parse(fullId);
    const kind = providerId === LOCAL ? 'llm.local' : 'llm.external';
    const key = providerId === LOCAL ? model : fullId;
    const [i, o] = await Promise.all([resolveRate(kind, key, 'token_in'), resolveRate(kind, key, 'token_out')]);
    return i + o;
}

export async function routeAroundUnhealthyModel(
    router: ProviderRouter,
    resolved: ResolvedProvider,
    p: { fallbackModel: string; userId?: string; userRole?: ProviderRouterContext['userRole']; lang?: string; onSystemEvent?: SystemEventCallback; alternates?: readonly string[] },
): Promise<ResolvedProvider> {
    if (!MODEL_HEALTH_ROUTING.ENABLED) return resolved;
    const health = judgeHealth(getModelHealth(resolved.modelId));
    if (health.verdict !== 'unhealthy') return resolved;
    try {
        const ids = [...(p.alternates ?? MODEL_HEALTH_ROUTING.ALTERNATES), p.fallbackModel]
            .filter((id, i, all) => all.indexOf(id) === i && id !== resolved.fullId && id !== resolved.modelId);
        const cands: RouteCandidate[] = await Promise.all(ids.map(async (fullId) => ({
            fullId, unitCost: await unitCost(fullId).catch(() => Number.MAX_SAFE_INTEGER), stats: getModelHealth(parse(fullId).model),
        })));
        for (const c of rankAlternates(cands)) {
            let next: ResolvedProvider;
            try {
                next = await runProviderGate(router, { requestedModel: c.fullId, fallbackModel: p.fallbackModel, ctx: { userId: p.userId, userRole: p.userRole } });
            } catch (e) {
                logger.info(`[HealthRoute] 후보 ${c.fullId} 정책·해석 실패 → 다음 후보 (${e instanceof Error ? e.message : String(e)})`);
                continue;
            }
            if (next.fullId === resolved.fullId) continue;
            logger.info(`[HealthRoute] ${resolved.fullId} 비정상(${health.reason}) → ${next.fullId}`);
            p.onSystemEvent?.({
                type: 'model_fallback',
                message: getModelUnhealthyFallbackMessage(p.lang),
                metadata: { from: resolved.fullId, to: next.fullId, reason: `model unhealthy: ${health.reason}`, code: 'MODEL_UNHEALTHY' },
            });
            return next;
        }
        logger.warn(`[HealthRoute] ${resolved.fullId} 비정상(${health.reason})이나 건강한 대체 후보 없음 — 그대로 진행`);
    } catch (e) {
        logger.warn(`[HealthRoute] 판정 실패(무시): ${e instanceof Error ? e.message : String(e)}`);
    }
    return resolved;
}
