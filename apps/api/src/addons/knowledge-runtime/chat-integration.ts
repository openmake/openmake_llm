/**
 * 채팅 턴 통합 — 세션이 Knowledge Space 에 연결돼 있을 때만 그 Space 안에서 근거를 검색해 컨텍스트로 붙인다.
 *
 * 권한 근거는 클라이언트가 보낸 spaceId·contextRefs 가 아니라 **DB 바인딩**이다(binding-service 가 소유+읽기 재확인).
 * 연결이 없으면(비연결 대화) 아무것도 주지 않는다 — 누출 0. 모델에는 수집·삭제·reindex 도구를 일절 주지 않는다(검색 컨텍스트뿐).
 *
 * @module addons/knowledge-runtime/chat-integration
 */
import type { ChatTurnIntegration, TurnContextInput, TurnContextContribution } from '../../services/chat-service/turn-integrations';
import { createLogger } from '../../utils/logger';
import { resolveBoundSpace, sessionHasBinding, listBoundSessionIdsForUser } from './conversations/binding-service';
import { actorFor } from './config/scope-policy';
import { touchSpace } from './spaces/repository';
import { retrieve } from './retrieval/service';
import { resolveSpaceProfiles } from './config/profiles';
import { resolveInjectionLimits } from './config/injection';
import { listMemoryRows } from './memories/repository';
import { spaceInstructionsBlock, spaceMemoryBlock } from './prompts';

const logger = createLogger('KnowledgeChat');

/**
 * 연결된 Space 소유자의 지침·메모리를 시스템 프롬프트 조각으로 만든다(연결 대화만). Base 는 이 조각을
 * custom instructions 뒤(동적 경계 뒤)에 그대로 붙인다 — 자료 근거(contextBlock)와 달리 매 턴 고정 안내다.
 * 실패는 조용히 빈 조각(검색·채팅에 영향 없음).
 */
async function buildSpaceSystemPromptPart(
    bound: { spaceId: string; instructions: string | null; configProfileId: string | null },
    userLang: string,
): Promise<string | undefined> {
    try {
        const limits = resolveInjectionLimits((await resolveSpaceProfiles(bound.configProfileId)).limits);
        const parts: string[] = [];
        if (bound.instructions && bound.instructions.trim()) {
            const block = spaceInstructionsBlock(bound.instructions, userLang, limits.maxInstructionTokens);
            if (block) parts.push(block);
        }
        const memoryRows = await listMemoryRows(bound.spaceId);
        if (memoryRows.length > 0) {
            const block = spaceMemoryBlock(memoryRows.map((m) => m.content), userLang, limits.maxMemoryTokens);
            if (block) parts.push(block);
        }
        return parts.length > 0 ? parts.join('\n\n') : undefined;
    } catch (e) {
        logger.warn('Space 지침·메모리 조립 실패(무시):', e);
        return undefined;
    }
}

async function prepareTurnContext(input: TurnContextInput): Promise<TurnContextContribution | undefined> {
    // 게스트·새 대화 첫 턴은 세션 문맥이 없어 대상이 아니다
    if (!input.userId || !input.sessionId) return undefined;

    // 세션이 어느 Space 에 연결됐는지 + 현재 사용자 인가를 함께 확인(권한 근거)
    const bound = await resolveBoundSpace(input.userId, input.sessionId);
    if (!bound) return undefined; // 비연결 대화 — 아무것도 붙이지 않는다

    const actor = await actorFor(input.userId);
    const [result, systemPromptPart] = await Promise.all([
        retrieve({
            actor,
            spaceIds: [bound.spaceId],
            query: input.message,
            sourceOffset: input.sourceOffset,
            userLang: input.userLang,
            configProfileId: bound.configProfileId,
        }),
        buildSpaceSystemPromptPart(bound, input.userLang),
    ]);

    // 사용 시각 갱신(표시·정렬용) — 실패해도 검색에는 영향 없음
    void touchSpace(bound.spaceId).catch((e) => logger.warn('last_used_at 갱신 실패(무시):', e));

    // 근거가 있으면 블록+출처, 없으면 "관련 자료 없음" 블록만(모델이 없다고 말하게).
    // 소유자 지침·메모리는 시스템 프롬프트 조각으로(연결 대화만).
    return { contextBlock: result.contextBlock, sources: result.sources, systemPromptPart };
}

export const knowledgeChatIntegration: ChatTurnIntegration = {
    id: 'knowledge-runtime',
    prepareTurnContext,
    // Space 에 연결된 대화는 메모리 격리 세션 — 그 대화의 사용자 메시지를 전역 user_memories 로 쓰지 않는다
    // (일반 채팅으로의 간접 누출 방지). 판정 실패는 Base 가 fail-closed 로 처리한다.
    isMemoryIsolatedSession: (_userId, sessionId) => sessionHasBinding(sessionId),
    // Space 에 연결된 대화는 사이드바 "최근 대화" 에서 빼고, 프로젝트 섹션 안에서만 보인다.
    listHiddenSessionIds: (userId) => listBoundSessionIdsForUser(userId),
};
