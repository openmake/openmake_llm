/**
 * WebSocket 채팅 메시지 처리
 * ChatRequestHandler를 통한 AI 채팅 스트리밍, 에러 핸들링을 담당합니다.
 * @module sockets/ws-chat-handler
 */
import { WebSocket } from 'ws';
import * as crypto from 'crypto';
import { ClusterManager } from '../cluster/manager';
import { selectOptimalModel } from '../chat/model-selector';
import { ChatRequestHandler, ChatRequestError } from '../chat/request-handler';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { KeyExhaustionError } from '../errors/key-exhaustion.error';
import { checkChatRateLimit } from '../middlewares/chat-rate-limiter';
import { createLogger } from '../utils/logger';
import { WSMessage, ExtendedWebSocket } from './ws-types';

/**
 * AI 채팅 메시지를 처리합니다.
 * ChatRequestHandler를 통해 공통 로직(모델 해석, 세션 관리, DB 저장)을 재사용하고,
 * WebSocket 고유 기능(abort, 웹 검색 컨텍스트, 진행 콜백)을 추가합니다.
 * @param ws - WebSocket 클라이언트 인스턴스
 * @param msg - 채팅 메시지 데이터 (message, model, history 등)
 * @param options - 클러스터 매니저, ExtendedWebSocket, 로거
 */
export async function handleChatMessage(
    ws: WebSocket,
    msg: WSMessage,
    options: { cluster: ClusterManager; extWs: ExtendedWebSocket; logger: ReturnType<typeof createLogger> }
): Promise<void> {
    const { cluster, extWs, logger: log } = options;

    if (typeof msg.message !== 'string' || msg.message.trim() === '') {
        ws.send(JSON.stringify({ type: 'error', message: '메시지가 필요합니다' }));
        return;
    }

    const { model, nodeId, history, images, docId, sessionId, anonSessionId } = msg;
    const message = msg.message.trim();

    // 중단 컨트롤러 생성
    const abortController = new AbortController();
    extWs._abortController = abortController;

    try {
        // 모델 결정 (자동 선택 또는 사용자 지정)
        let selectedModel = model;
        if (!model || model === 'default') {
            const optimalModel = await selectOptimalModel(message);
            selectedModel = optimalModel.model;
            log.debug(`[Chat] 🎯 자동 모델 선택: ${selectedModel} (${optimalModel.reason})`);
        }

        // 사용자 컨텍스트 구성 (ChatRequestHandler 통합)
        const userContext = ChatRequestHandler.resolveUserContextFromWebSocket(
            extWs._authenticatedUserId,
            extWs._authenticatedUserRole,
            extWs._authenticatedUserTier,
            msg.userId as string | undefined,
            anonSessionId,
        );

        // 채팅 레이트 리밋 체크
        const rateLimitError = await checkChatRateLimit(
            extWs._authenticatedUserId,
            userContext.userRole,
            userContext.userTier,
        );
        if (rateLimitError) {
            ws.send(JSON.stringify({ type: 'error', error: rateLimitError }));
            return;
        }

        // 시사 관련 질문 감지 및 웹 검색 컨텍스트 구성
        const currentEventsKeywords = ['대통령', '총리', '장관', '현재', '지금', '오늘', '최근', '뉴스', '선거', '정치', '국회', '정부', '탄핵', '취임'];
        const isCurrentEventsQuery = currentEventsKeywords.some(keyword => message?.includes(keyword));
        let webSearchContext = '';

        if (isCurrentEventsQuery) {
            try {
                const { performWebSearch } = await import('../mcp');
                const searchResults = await performWebSearch(message, { maxResults: 5 });
                if (searchResults.length > 0) {
                    webSearchContext = `\n\n## 🔍 웹 검색 결과 (${new Date().toLocaleDateString('ko-KR')} 기준)\n` +
                        `다음은 최신 웹 검색 결과입니다. 이 정보를 우선적으로 참고하여 답변하세요:\n\n` +
                        searchResults.map((r: { title?: string; url?: string; snippet?: string }, i: number) => `[출처 ${i + 1}] ${r.title}\n   URL: ${r.url}\n${r.snippet ? `   내용: ${r.snippet}\n` : ''}`).join('\n') + '\n';
                }
            } catch (e) {
                log.error('[Chat] 웹 검색 실패:', e);
            }
        }

        // WS 고유: 세션 생성 시 length < 10 체크 (노드 ID와 구별)
        const validSessionId = (sessionId && sessionId.length >= 10) ? sessionId : undefined;

        // messageId 생성 (WS 고유: 토큰 스트리밍에 사용)
        const messageId = crypto.randomUUID
            ? crypto.randomUUID()
            : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // 토큰 콜백에서 중단 여부 체크 (WS 고유)
        const tokenCallback = (token: string) => {
            if (abortController.signal.aborted) {
                throw new Error('ABORTED');
            }
            ws.send(JSON.stringify({ type: 'token', token, messageId }));
        };

        // ChatRequestHandler.processChat으로 통합 처리
        const result = await ChatRequestHandler.processChat({
            message,
            model: selectedModel,
            nodeId,
            history,
            images,
            docId,
            sessionId: validSessionId,
            webSearchContext,
            discussionMode: msg.discussionMode === true,
            deepResearchMode: msg.deepResearchMode === true,
            thinkingMode: msg.thinkingMode === true,
            thinkingLevel: (msg.thinkingLevel || 'high') as 'low' | 'medium' | 'high',
            enabledTools: msg.enabledTools,
            userContext,
            clusterManager: cluster,
            abortSignal: abortController.signal,
            onToken: tokenCallback,
            onAgentSelected: (agent) => ws.send(JSON.stringify({ type: 'agent_selected', agent })),
            onDiscussionProgress: (progress) => ws.send(JSON.stringify({ type: 'discussion_progress', progress })),
            onResearchProgress: (progress) => ws.send(JSON.stringify({ type: 'research_progress', progress })),
            onSkillsActivated: (skillNames) => ws.send(JSON.stringify({ type: 'skills_activated', skillNames })),
        });

        // WS 고유: 새 세션 생성 알림
        if (!validSessionId) {
            ws.send(JSON.stringify({ type: 'session_created', sessionId: result.sessionId }));
        }

        log.info('[Chat] 생성 완료');
        ws.send(JSON.stringify({ type: 'done', messageId }));

    } catch (error: unknown) {
        // 중단 컨트롤러 정리
        extWs._abortController = null;

        // 중단된 경우
        if (error instanceof Error && error.message === 'ABORTED') {
            log.info('[Chat] 사용자에 의해 중단됨');
            // aborted 메시지는 handleAbort에서 이미 전송됨
            return;
        }

        if (error instanceof ChatRequestError) {
            log.warn('[Chat] 요청 처리 에러:', error.message);
            ws.send(JSON.stringify({ type: 'error', message: error.message }));
        } else if (error instanceof QuotaExceededError) {
            log.warn('[Chat] API 할당량 초과:', error.message);
            ws.send(JSON.stringify({
                type: 'error',
                message: `⚠️ API 할당량이 초과되었습니다 (${error.quotaType}). ${error.used}/${error.limit} 요청 사용됨. 잠시 후 다시 시도해주세요.`,
                errorType: 'quota_exceeded',
                retryAfter: error.retryAfterSeconds
            }));
        } else if (error instanceof KeyExhaustionError) {
            // 🆕 모든 API 키 소진 에러 처리
            log.warn('[Chat] 모든 API 키 소진:', error.message);
            ws.send(JSON.stringify({
                type: 'error',
                message: error.getDisplayMessage('ko'),
                errorType: 'api_keys_exhausted',
                retryAfter: error.retryAfterSeconds,
                resetTime: error.resetTime.toISOString(),
                totalKeys: error.totalKeys,
                keysInCooldown: error.keysInCooldown
            }));
        } else {
            log.error('[Chat] 처리 중 오류:', error);
            // 🔒 Phase 2: 내부 에러 상세 누출 방지 — 제네릭 메시지만 전송
            ws.send(JSON.stringify({ type: 'error', message: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }));
        }
    } finally {
        // 중단 컨트롤러 정리
        extWs._abortController = null;
    }
}
