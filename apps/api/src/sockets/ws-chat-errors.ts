/**
 * WebSocket 채팅 에러 응답 발행 — ws-chat-handler.ts 의 catch 블록에서 분리 (max-lines 가드).
 * 에러 종류별 사용자 메시지 분류 + 일반 오류의 디버그 자동 보존(B4).
 * @module sockets/ws-chat-errors
 */
import { ChatRequestError } from '../chat/request-handler';
import { enqueueDebugCapture, DEBUG_QUEUE_TTL_MS } from '../data/conversation-debug-queue';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { QuotaUnavailableError } from '../errors/quota-unavailable.error';
import { ProviderError } from '../providers/provider-errors';
import { createLogger } from '../utils/logger';
import { WS_ERROR_MESSAGES, providerErrorMessage, getLocalizedTemplate } from './ws-chat-locales';
import type { WsChatOut } from './ws-chat-artifacts';

export function sendChatError(error: unknown, ctx: {
    out: WsChatOut;
    log: ReturnType<typeof createLogger>;
    userLang: string;
    validSessionId: string | undefined;
    message: string;
    authenticatedUserId: string | null;
    selectedModel: string | undefined;
    tokenCount: number;
    partialAssistantResponse: string;
}): void {
    const { out, log, userLang, validSessionId, message, selectedModel, tokenCount, partialAssistantResponse } = ctx;
    /** WebSocket 에러 응답 페이로드 */
    interface ChatWSErrorPayload {
        type: 'error';
        message: string;
        errorType?: string;
        retryAfter?: number;
        resetTime?: string;
        totalKeys?: number;
        keysInCooldown?: number;
    }

    const safeSend = (data: ChatWSErrorPayload) => out({ ...data });

    if (error instanceof ChatRequestError) {
        log.warn('[Chat] 요청 처리 에러:', error.message);
        safeSend({ type: 'error', message: error.message });
    } else if (error instanceof QuotaExceededError) {
        log.warn('[Chat] API 할당량 초과:', error.message);
        safeSend({
            type: 'error',
            message: `⚠️ ${getLocalizedTemplate(WS_ERROR_MESSAGES, userLang).quotaExceeded} (${error.quotaType}). ${error.used}/${error.limit}.`,
            errorType: 'quota_exceeded',
            retryAfter: error.retryAfterSeconds,
            ...(error.approvalRequestId ? { approvalRequestId: error.approvalRequestId } : {}),
        });
    } else if (error instanceof QuotaUnavailableError) {
        log.error('[Chat] 쿼터 저장소 장애 (fail-closed):', error.message);
        safeSend({ type: 'error', message: `⚠️ ${error.message}`, errorType: 'quota_unavailable', retryAfter: error.retryAfterSeconds });
    } else if (error instanceof ProviderError) {
        // 외부 provider(Anthropic/OpenRouter) 에러 — 코드별 사용자 친화 메시지로 분류
        // raw upstream 메시지(error.message)는 stack/credential 누출 위험으로 노출하지 않음
        const causeDetail = error.cause instanceof Error
            ? `${error.cause.message}${(error.cause as { status?: number }).status ? ` [status=${(error.cause as { status?: number }).status}]` : ''}`
            : (error.cause ? JSON.stringify(error.cause).slice(0, 300) : '');
        log.warn(`[Chat] 외부 provider 에러 (${error.code}): ${error.message} | cause: ${causeDetail}`);
        safeSend({
            type: 'error',
            message: providerErrorMessage(userLang, error.code, (error as { status?: number }).status),
            errorType: error.code.toLowerCase(),
        });
    } else {
        log.error('[Chat] 처리 중 오류:', error);
        // 🔒 Phase 2: 내부 에러 상세 누출 방지 — 제네릭 메시지만 전송
        safeSend({ type: 'error', message: getLocalizedTemplate(WS_ERROR_MESSAGES, userLang).genericError });

        // B+ Phase B4: 디버그 자동 보존 — 사용자 saveHistory=false 여도
        // 에러 재현을 위해 본문을 24h 임시 보관 (TTL 후 자동 삭제)
        if (validSessionId && message) {
            const auditUserId = ctx.authenticatedUserId || 'anonymous';
            const errorCode = error instanceof Error ? error.name : 'UnknownError';
            enqueueDebugCapture({
                sessionId: validSessionId,
                userId: auditUserId,
                reason: 'auto-error',
                userMessage: message,
                assistantMessage: partialAssistantResponse,
                errorCode,
                routingMetadata: {
                    model: selectedModel,
                    tokenCountAtError: tokenCount,
                    partialResponseLength: partialAssistantResponse.length,
                },
            }).then((capture) => {
                if (capture) {
                    // 사용자에게 보존 사실 + 만료 시각 알림 (선택적 신뢰 회복)
                    const expiresInMs = DEBUG_QUEUE_TTL_MS['auto-error'];
                    out({
                        type: 'debug_retained',
                        captureId: capture.id,
                        expiresAt: capture.expiresAt.toISOString(),
                        ttlHours: Math.round(expiresInMs / 3600000),
                    });
                }
            }).catch(() => {/* 디버그 큐 실패는 사용자 흐름 안 막음 */});
        }
    }
}
