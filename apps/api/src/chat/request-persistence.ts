/**
 * ============================================================
 * 채팅 요청 영속화 (세션/메시지 DB 저장)
 * ============================================================
 * request-handler.ts 에서 분리 (파일 크기 가드 — DB 영속화 책임 분리).
 * 세션 확보 + 사용자/AI 메시지 저장 + audit log 기록을 담당하는 순수 함수 모음.
 * leaf 데이터 계층(conversation-db, conversation-audit)만 import → 순환 없음.
 *
 * 저장 정책 (B+): audit log 는 항상 INSERT(운영 메트릭), 본문 INSERT 는
 * saveHistory !== false 일 때만 (사용자 통제).
 *
 * @module chat/request-persistence
 */

import { getConversationDB } from '../data/conversation-db';
import { recordAuditLog } from '../data/conversation-audit';
import { createLogger } from '../utils/logger';

const log = createLogger('ChatRequestPersistence');

/**
 * 세션이 없으면 새로 생성합니다.
 *
 * @param sessionId - 기존 세션 ID (없으면 생성)
 * @param authenticatedUserId - 인증된 사용자 ID (FK 호환)
 * @param message - 세션 제목용 메시지 (앞 30자)
 * @param anonSessionId - 비로그인 브라우저 소유자 ID
 * @returns 유효한 세션 ID
 */
export async function ensureSession(
    sessionId: string | undefined,
    authenticatedUserId: string | null,
    message: string,
    anonSessionId?: string,
    userRole: 'admin' | 'user' | 'guest' = 'guest',
    // 2026-05-26 Phase 3.4 fork: 메시지 편집 분기 시 부모 세션 추적 (metadata 에 저장).
    branchMeta?: { parentSessionId?: string; parentMessageId?: string },
): Promise<string> {
    const conversationDb = getConversationDB();

    if (sessionId) {
        if (userRole === 'admin') {
            return sessionId;
        }

        const session = await conversationDb.getSession(sessionId);
        const ownsAuthenticatedSession = !!authenticatedUserId && session?.userId === authenticatedUserId;
        const ownsAnonymousSession = !authenticatedUserId && !!anonSessionId && session?.anonSessionId === anonSessionId;
        if (!session || (!ownsAuthenticatedSession && !ownsAnonymousSession)) {
            throw new Error('SESSION_ACCESS_DENIED');
        }
        return sessionId;
    }

    const metadata: Record<string, unknown> | undefined = branchMeta && branchMeta.parentSessionId
        ? {
            parentSessionId: branchMeta.parentSessionId,
            ...(branchMeta.parentMessageId ? { parentMessageId: branchMeta.parentMessageId } : {}),
            forkedAt: new Date().toISOString(),
        }
        : undefined;

    const session = await conversationDb.createSession(
        authenticatedUserId || undefined,
        message.substring(0, 30),
        metadata,
        anonSessionId,
    );

    log.info(
        `새 세션 생성: ${session.id}, userId: ${authenticatedUserId || 'null'}, anonSessionId: ${anonSessionId || 'none'}` +
        (branchMeta?.parentSessionId ? ` ← branch from ${branchMeta.parentSessionId}` : '')
    );
    return session.id;
}

/**
 * 사용자 메시지를 DB에 저장합니다.
 *
 * @param sessionId - 세션 ID
 * @param userId - 감사 로그용 사용자 ID
 * @param message - 메시지 본문
 * @param model - 표시용 모델명
 * @param saveHistory - 본문 저장 여부 (기본 true)
 */
/**
 * 메시지 토큰 수 근사 추정.
 *
 * 정확한 LLM usage 는 ChatService.processMessage 반환값에 실려있지 않아(반환 타입
 * 변경 시 광범위 회귀 위험), conversation_messages.tokens(오직 일별/애널리틱스
 * breakdown 쿼리만 소비 — 쿼터/총량은 usage-tracker 별도 소스)를 추정치로 채운다.
 * 한글/CJK ~1.1 char/token, 영문/기타 ~4 char/token 블렌드 근사.
 */
function estimateTokens(text: string): number {
    if (!text) return 0;
    const cjk = (text.match(/[ㄱ-힝一-鿿぀-ヿ]/g) || []).length;
    const rest = text.length - cjk;
    return Math.max(1, Math.round(cjk / 1.1 + rest / 4));
}

export async function saveUserMessage(
    sessionId: string,
    userId: string,
    message: string,
    model?: string,
    saveHistory: boolean = true,
): Promise<void> {
    // 1. 감사 로그 — 항상 (실패해도 채팅 흐름 유지)
    await recordAuditLog({
        sessionId,
        userId,
        messageRole: 'user',
        model,
        contentSkipped: !saveHistory,
        contentLength: message.length,
    });

    // 2. 본문 저장 — saveHistory=true 일 때만
    if (saveHistory) {
        const conversationDb = getConversationDB();
        await conversationDb.addMessage(sessionId, 'user', message, { model, tokensUsed: estimateTokens(message) });
    }
}

/**
 * AI 응답을 DB에 저장합니다.
 *
 * @param sessionId - 세션 ID
 * @param userId - 감사 로그용 사용자 ID
 * @param response - 응답 본문
 * @param model - 표시용 모델명
 * @param responseTime - 응답 소요 시간 (ms)
 * @param saveHistory - 본문 저장 여부 (기본 true)
 */
export async function saveAssistantMessage(
    sessionId: string,
    userId: string,
    response: string,
    model?: string,
    responseTime?: number,
    saveHistory: boolean = true,
): Promise<void> {
    // 1. 감사 로그 — 항상
    await recordAuditLog({
        sessionId,
        userId,
        messageRole: 'assistant',
        model,
        responseTimeMs: responseTime,
        contentSkipped: !saveHistory,
        contentLength: response.length,
    });

    // 2. 본문 저장 — saveHistory=true 일 때만
    if (saveHistory) {
        const conversationDb = getConversationDB();
        await conversationDb.addMessage(sessionId, 'assistant', response, {
            model,
            responseTime,
            tokensUsed: estimateTokens(response),
        });
    }
}
