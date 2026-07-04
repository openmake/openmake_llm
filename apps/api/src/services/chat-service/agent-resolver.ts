/**
 * ============================================================
 * Agent Resolver — 에이전트 라우팅 모듈
 * ============================================================
 *
 * 경량화 3단계(캐시 → 키워드 선분류 → 短문장 직행)를 거친 뒤에만
 * LLM 의미론적 라우팅을 호출하고, 실패 시 키워드 결과로 폴백합니다.
 * (2026-07-04: LLM 라우팅이 매 채팅 첫 청크에 ~2-3s + ~2.7k 토큰의
 * 고정 비용을 부과하던 것을 절감 — 단순/반복 질문은 LLM 호출 0회.)
 * ChatService.resolveAgent 메서드에서 추출되었습니다.
 *
 * @module services/chat-service/agent-resolver
 */
import { createLogger } from '../../utils/logger';
import { routeToAgent, getAgentSystemMessage, AGENTS, getAgentById, detectPhase, type AgentSelection } from '../../agents';
import { routeWithLLM, isValidAgentId } from '../../agents/llm-router';
import { getCacheSystem } from '../../cache';
import {
    AGENT_ROUTE_CACHE_ENABLED,
    AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE,
    AGENT_SHORT_QUERY_MAX_CHARS,
    AGENT_SHORT_QUERY_KEYWORD_CEILING,
} from '../../config/routing-config';

const logger = createLogger('AgentResolver');

/**
 * 에이전트 선택 — LLM 호출 전 경량 경로 3단계를 우선 시도.
 *
 * 1. **캐시**: 정규화된 동일 질문의 이전 라우팅 결과 재사용 (LRU, cache/index.ts)
 * 2. **키워드 선분류**: 키워드 라우터 신뢰도가 임계 이상이면 그대로 채택
 * 3. **短문장 직행**: 짧은 질문 + 키워드 신호 없음 → 'general' (단답형 잡담·산술 등)
 * 4. **LLM 라우팅**: 위 모두 미해당 시에만 호출. 실패하면 1회 실행해 둔 키워드
 *    결과를 재사용해 폴백 (기존의 폴백 재호출 1회도 절감).
 */
async function selectAgent(message: string): Promise<AgentSelection> {
    const cache = getCacheSystem();

    // ① 캐시 히트 — 동일 질문 재라우팅 생략
    if (AGENT_ROUTE_CACHE_ENABLED) {
        const cached = cache.getRoutingResult(message);
        if (cached && isValidAgentId(cached.agentId)) {
            logger.info(`캐시 라우팅 재사용: ${cached.agentId} (신뢰도: ${cached.confidence})`);
            return {
                primaryAgent: cached.agentId,
                category: getAgentById(cached.agentId)?.category || 'general',
                phase: detectPhase(message),
                reason: '[Cache] 동일 질문의 이전 라우팅 재사용',
                confidence: cached.confidence,
                matchedKeywords: [],
            };
        }
    }

    // ② 키워드 선분류 — 고신뢰 매칭이면 LLM 스킵 (키워드 라우팅은 ms 단위 CPU 연산)
    const keywordSelection = await routeToAgent(message);
    const keywordConfidence = keywordSelection.confidence ?? 0;
    if (keywordConfidence >= AGENT_KEYWORD_PRECLASSIFY_CONFIDENCE) {
        logger.info(`키워드 선분류 채택: ${keywordSelection.primaryAgent} (신뢰도: ${keywordConfidence}) — LLM 라우팅 스킵`);
        const selection = { ...keywordSelection, reason: `[Keyword] ${keywordSelection.reason}` };
        if (AGENT_ROUTE_CACHE_ENABLED) cache.setRoutingResult(message, selection.primaryAgent, keywordConfidence);
        return selection;
    }

    // ③ 短문장 + 키워드 신호 없음 → 'general' 직행 (예: "1+1은?", "고마워")
    // matchedKeywords 가 1개라도 있으면 단일 키워드 매치(신뢰도 낮아도 도메인 신호)로
    // 간주하고 直行하지 않는다 — LLM 라우팅이 세부 전문가를 고르게 위임.
    if (AGENT_SHORT_QUERY_MAX_CHARS > 0
        && message.trim().length <= AGENT_SHORT_QUERY_MAX_CHARS
        && keywordConfidence <= AGENT_SHORT_QUERY_KEYWORD_CEILING
        && (keywordSelection.matchedKeywords?.length ?? 0) === 0) {
        logger.info(`短문장 직행: general (길이 ${message.trim().length} ≤ ${AGENT_SHORT_QUERY_MAX_CHARS}, 키워드 신뢰도 ${keywordConfidence}) — LLM 라우팅 스킵`);
        return {
            primaryAgent: 'general',
            category: 'general',
            phase: detectPhase(message),
            reason: '[Short-query] 짧은 질문 + 도메인 키워드 없음 — 범용 에이전트 직행',
            confidence: keywordConfidence,
            matchedKeywords: [],
        };
    }

    // ④ LLM 의미론적 라우팅 (기존 경로)
    const llmResult = await routeWithLLM(message);
    if (llmResult && llmResult.agentId && isValidAgentId(llmResult.agentId)) {
        logger.info(`LLM 라우팅 성공: ${llmResult.agentId} (신뢰도: ${llmResult.confidence})`);
        if (AGENT_ROUTE_CACHE_ENABLED) cache.setRoutingResult(message, llmResult.agentId, llmResult.confidence);
        return {
            primaryAgent: llmResult.agentId,
            category: getAgentById(llmResult.agentId)?.category || 'general',
            phase: detectPhase(message),
            reason: `[LLM] ${llmResult.reasoning}`,
            confidence: llmResult.confidence,
            matchedKeywords: [],
        };
    }

    // ⑤ 폴백 — ②에서 이미 실행한 키워드 결과 재사용 (재호출 없음)
    logger.info(`키워드 폴백 라우팅: ${keywordSelection.primaryAgent}`);
    return keywordSelection;
}

/**
 * resolveAgent 함수의 반환값
 */
export interface AgentResolutionResult {
    agentSelection: AgentSelection;
    agentSystemMessage: string;
    selectedAgent: (typeof AGENTS)[string];
}

/**
 * 경량 3단계(캐시/키워드 선분류/短문장 직행) → LLM 라우팅 → 키워드 폴백 순으로
 * 에이전트를 선택하고 시스템 프롬프트를 구성합니다.
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
    const agentSelection: AgentSelection = await selectAgent(message);

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
