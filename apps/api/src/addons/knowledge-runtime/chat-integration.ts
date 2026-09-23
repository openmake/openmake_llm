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
import { resolveBoundSpace } from './conversations/binding-service';
import { actorFor } from './config/scope-policy';
import { touchSpace } from './spaces/repository';
import { retrieve } from './retrieval/service';

const logger = createLogger('KnowledgeChat');

async function prepareTurnContext(input: TurnContextInput): Promise<TurnContextContribution | undefined> {
    // 게스트·새 대화 첫 턴은 세션 문맥이 없어 대상이 아니다
    if (!input.userId || !input.sessionId) return undefined;

    // 세션이 어느 Space 에 연결됐는지 + 현재 사용자 인가를 함께 확인(권한 근거)
    const bound = await resolveBoundSpace(input.userId, input.sessionId);
    if (!bound) return undefined; // 비연결 대화 — 아무것도 붙이지 않는다

    const actor = await actorFor(input.userId);
    const result = await retrieve({
        actor,
        spaceIds: [bound.spaceId],
        query: input.message,
        sourceOffset: input.sourceOffset,
        userLang: input.userLang,
        configProfileId: bound.configProfileId,
    });

    // 사용 시각 갱신(표시·정렬용) — 실패해도 검색에는 영향 없음
    void touchSpace(bound.spaceId).catch((e) => logger.warn('last_used_at 갱신 실패(무시):', e));

    // 근거가 있으면 블록+출처, 없으면 "관련 자료 없음" 블록만(모델이 없다고 말하게)
    return { contextBlock: result.contextBlock, sources: result.sources };
}

export const knowledgeChatIntegration: ChatTurnIntegration = {
    id: 'knowledge-runtime',
    prepareTurnContext,
};
