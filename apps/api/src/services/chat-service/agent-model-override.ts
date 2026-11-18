/**
 * Custom Agent 모델 배정 (Phase C) — message-pipeline 에서 분리 (파일 크기 가드).
 *
 * 요청 model 이 자동('default'/빈값)일 때만 에이전트 정의의 model 로 대체 —
 * 사용자의 명시적 모델 선택이 항상 우선. provider-gate 이전 단일 지점에서
 * 호출되어 로컬/외부 분기 대칭을 보장한다.
 * countUsage:false — usage_count 는 외부 분기의 본 로드에서만 1회 증가.
 *
 * @module services/chat-service/agent-model-override
 */
import { getExecutionPlanBuilder } from '../../chat/execution-plan-builder';
import { createLogger } from '../../utils/logger';
import { ProviderError } from '../../providers/provider-errors';
import type { ProviderRouter, ProviderRouterContext, ResolvedProvider } from '../../providers/provider-router';
import type { SystemEventCallback } from '../chat-service-types';
import { normalizeToFullId, runProviderGate } from './provider-gate';

const logger = createLogger('AgentModelOverride');

/** "자동" 모델 판정 — 웹은 자동을 'default' 로 보낸다. WS 핸들러와 이 모듈이 함께 쓴다. */
export function isAutoModel(model: string | undefined): boolean {
    return !model || model.trim() === '' || model === 'default';
}

/** 자동이면 에이전트 배정 모델(없으면 undefined = 게이트 fallback), 명시면 그대로. fromAgent 는 배정 모델 적용 여부 */
export async function applyAgentModelOverride(
    requestedModel: string | undefined,
    userAgentId: string | undefined,
    userId: string | number | undefined,
): Promise<{ model: string | undefined; fromAgent: boolean }> {
    if (!isAutoModel(requestedModel)) return { model: requestedModel, fromAgent: false };
    if (!userAgentId || !userId || String(userId) === 'guest') return { model: undefined, fromAgent: false };
    try {
        const preAgent = await getExecutionPlanBuilder()
            .loadUserAgent(userAgentId, String(userId), { countUsage: false });
        if (preAgent?.model) {
            logger.info(`[UserAgent] 에이전트 모델 배정 적용: ${preAgent.model} (agent=${preAgent.name})`);
            return { model: preAgent.model, fromAgent: true };
        }
    } catch (e) {
        logger.warn('[UserAgent] 에이전트 모델 조회 실패 (silent — 기본 모델 사용):', e);
    }
    return { model: undefined, fromAgent: false };
}

/**
 * 에이전트 배정을 적용해 provider gate 를 통과시킨다.
 * 배정 모델이 ProviderError 로 거절되면 — 고지 채널(onSystemEvent)이 있을 때만 — 자동으로 한 번 더 해석하고
 * model_fallback 으로 알린다. 고지 채널이 없으면(HTTP) 조용히 바꾸지 않고 원래 오류를 던진다.
 * 사용자가 명시한 모델의 거절·ProviderError 가 아닌 예외는 그대로 던진다.
 */
export async function runGateWithAgentModel(
    router: ProviderRouter,
    input: {
        requestedModel: string | undefined;
        userAgentId: string | undefined;
        userId: ProviderRouterContext['userId'];
        userRole: ProviderRouterContext['userRole'];
        fallbackModel: string;
        onSystemEvent?: SystemEventCallback;
    },
): Promise<ResolvedProvider> {
    const { model, fromAgent } = await applyAgentModelOverride(input.requestedModel, input.userAgentId, input.userId);
    const ctx: ProviderRouterContext = { userId: input.userId, userRole: input.userRole };
    try {
        return await runProviderGate(router, { requestedModel: model, fallbackModel: input.fallbackModel, ctx });
    } catch (err) {
        if (!fromAgent || !input.onSystemEvent || !(err instanceof ProviderError)) throw err;
        const resolved = await runProviderGate(router, { requestedModel: undefined, fallbackModel: input.fallbackModel, ctx });
        const from = normalizeToFullId(model, input.fallbackModel);
        logger.warn(`[UserAgent] 배정 모델 거절 → 기본 모델: ${from} → ${resolved.fullId} (${err.code})`);
        input.onSystemEvent({
            type: 'model_fallback',
            message: `선택한 모델(${from})을 사용할 수 없어 기본 모델로 답변합니다.`,
            metadata: { from, to: resolved.fullId, reason: err.message.slice(0, 200), code: err.code },
        });
        return resolved;
    }
}
