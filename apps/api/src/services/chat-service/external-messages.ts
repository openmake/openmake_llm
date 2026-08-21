/**
 * External Provider 메시지 배열 조립 — 시스템 프롬프트 + history + 현재 turn.
 *
 * external-provider 본체(600줄 CI 가드)에서 분리. 순수 함수 — 입력만으로 messages 를 만든다.
 *
 * @module services/chat-service/external-messages
 */
import { buildExternalSystemPrompt } from './external-system-prompt';
import type { ChatMessage } from '../../llm';
import type { ChatMessageRequest } from '../chat-service-types';
import type { ResolvedProvider } from '../../providers/provider-router';
import type { StreamFromExternalContext } from './external-provider-types';
import type { OrchestrationIntents } from './external-tool-plan';

/** 요청 1건의 messages 배열을 조립한다. */
export function buildExternalMessages(params: {
    req: ChatMessageRequest;
    resolved: ResolvedProvider;
    ctx: StreamFromExternalContext;
    wantsMap: boolean;
    orchestration: OrchestrationIntents;
    wantsSpawn: boolean;
}): ChatMessage[] {
    const { req, resolved, ctx, wantsMap, orchestration, wantsSpawn } = params;
    const messages: ChatMessage[] = [];

    // 시스템 프롬프트 조립(정적 헌법 → DYNAMIC → 가변)은 external-system-prompt 로 분리.
    const systemContent = buildExternalSystemPrompt({ req, resolved, ctx, wantsMap, orchestration, wantsSpawn });
    if (systemContent) {
        messages.push({ role: 'system', content: systemContent });
    }

    // history 에 섞인 system 은 배열에 두지 않고 맨 앞 system 에 병합한다 — 드롭하면
    // 호출자의 지시 계약이 사라지고(2026-08-20 실측), 배열에 남기면 두 번째 system 의
    // 수용 여부가 채팅 템플릿/provider 구현에 의존한다.
    // 근거 전문 + tools 요청 경로의 동일 대응: chat/external-tool-calling.ts
    const clientSystemParts: string[] = [];

    for (const h of req.history ?? []) {
        if (h.role === 'system') {
            if (h.content) clientSystemParts.push(h.content);
            continue;
        }
        const role = h.role === 'user' || h.role === 'assistant'
            ? h.role
            : 'user';
        messages.push({
            role,
            content: h.content,
            ...(h.images ? { images: h.images } : {}),
        });
    }

    if (clientSystemParts.length > 0) {
        // 자체 system 이 없는 경우(systemContent 빈 값)엔 클라이언트 system 이 맨 앞 system 이 된다.
        if (messages[0]?.role === 'system') {
            messages[0].content = [messages[0].content, ...clientSystemParts].join('\n\n');
        } else {
            messages.unshift({ role: 'system', content: clientSystemParts.join('\n\n') });
        }
    }

    messages.push({
        role: 'user',
        content: ctx.enhancedMessage || req.message,
        ...(req.images ? { images: req.images } : {}),
    });

    return messages;
}
