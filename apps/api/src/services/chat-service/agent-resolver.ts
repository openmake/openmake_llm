/**
 * ============================================================
 * Agent Resolver — 에이전트 라우팅 모듈
 * ============================================================
 *
 * LLM 의미론적 라우팅 → 키워드 폴백으로 에이전트를 선택하고
 * 시스템 프롬프트를 구성합니다.
 * ChatService.resolveAgent 메서드에서 추출되었습니다.
 *
 * @module services/chat-service/agent-resolver
 */
import { createLogger } from '../../utils/logger';
import { routeToAgent, getAgentSystemMessage, AGENTS, getAgentById, detectPhase, type AgentSelection } from '../../agents';
import { routeWithLLM, isValidAgentId } from '../../agents/llm-router';

const logger = createLogger('AgentResolver');

/**
 * resolveAgent 함수의 반환값
 */
export interface AgentResolutionResult {
    agentSelection: AgentSelection;
    agentSystemMessage: string;
    selectedAgent: (typeof AGENTS)[string];
}

/**
 * LLM 의미론적 라우팅 → 키워드 폴백으로 에이전트를 선택하고 시스템 프롬프트를 구성합니다.
 *
 * @param message - 사용자 메시지
 * @param userId - 사용자 ID
 * @param languageCode - 응답 언어 코드
 * @param onAgentSelected - 에이전트 선택 결과 콜백
 * @param onSkillsActivated - 활성화된 스킬 콜백
 * @returns 에이전트 선택 결과, 시스템 메시지, 선택된 에이전트 정보
 */
export async function resolveAgent(
    message: string,
    userId: string | undefined,
    languageCode: string,
    onAgentSelected?: (agent: { type: string; name: string; emoji?: string; phase?: string; reason?: string; confidence?: number }) => void,
    onSkillsActivated?: (skillNames: string[]) => void,
): Promise<AgentResolutionResult> {
    let agentSelection: AgentSelection;
    const llmResult = await routeWithLLM(message);

    if (llmResult && llmResult.agentId && isValidAgentId(llmResult.agentId)) {
        agentSelection = {
            primaryAgent: llmResult.agentId,
            category: getAgentById(llmResult.agentId)?.category || 'general',
            phase: detectPhase(message),
            reason: `[LLM] ${llmResult.reasoning}`,
            confidence: llmResult.confidence,
            matchedKeywords: []
        };
        logger.info(`LLM 라우팅 성공: ${llmResult.agentId} (신뢰도: ${llmResult.confidence})`);
    } else {
        agentSelection = await routeToAgent(message);
        logger.info(`키워드 폴백 라우팅: ${agentSelection.primaryAgent}`);
    }

    const { prompt: agentSystemMessage, skillNames } = await getAgentSystemMessage(agentSelection, userId || undefined, languageCode);
    const selectedAgent = AGENTS[agentSelection.primaryAgent];
    logger.info(`에이전트: ${selectedAgent.emoji} ${selectedAgent.name}`);

    if (onAgentSelected && selectedAgent) {
        onAgentSelected({
            type: agentSelection.primaryAgent,
            name: selectedAgent.name,
            emoji: selectedAgent.emoji,
            phase: agentSelection.phase || 'planning',
            reason: agentSelection.reason || '',
            confidence: agentSelection.confidence || 0.5,
        });
    }

    if (onSkillsActivated && skillNames.length > 0) {
        onSkillsActivated(skillNames);
    }

    return { agentSelection, agentSystemMessage, selectedAgent };
}
