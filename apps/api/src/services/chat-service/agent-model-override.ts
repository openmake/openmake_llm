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

const logger = createLogger('AgentModelOverride');

export async function applyAgentModelOverride(
    requestedModel: string | undefined,
    userAgentId: string | undefined,
    userId: string | number | undefined,
): Promise<string | undefined> {
    if (!userAgentId || !userId || String(userId) === 'guest') return requestedModel;
    if (requestedModel && requestedModel !== 'default') return requestedModel;
    try {
        const preAgent = await getExecutionPlanBuilder()
            .loadUserAgent(userAgentId, String(userId), { countUsage: false });
        if (preAgent?.model) {
            logger.info(`[UserAgent] 에이전트 모델 배정 적용: ${preAgent.model} (agent=${preAgent.name})`);
            return preAgent.model;
        }
    } catch (e) {
        logger.warn('[UserAgent] 에이전트 모델 조회 실패 (silent — 기본 모델 사용):', e);
    }
    return requestedModel;
}
