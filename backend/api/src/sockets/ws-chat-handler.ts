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
import { enqueueDebugCapture, DEBUG_QUEUE_TTL_MS } from '../data/conversation-debug-queue';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { KeyExhaustionError } from '../errors/key-exhaustion.error';
import { ProviderError } from '../providers/provider-errors';
import { checkChatRateLimit } from '../middlewares/chat-rate-limiter';
import { createLogger } from '../utils/logger';
import { WSMessage, ExtendedWebSocket } from './ws-types';
import { CURRENT_EVENTS_KEYWORDS, WEB_SEARCH_TEMPLATES, WS_ERROR_MESSAGES, WS_PROVIDER_ERROR_MESSAGES, getLocalizedTemplate } from './ws-chat-locales';
import { detectLanguage, type SupportedLanguageCode } from '../chat/language-policy';
import { getStaleDataWarning } from '../config/stale-data-warning';
import { ArtifactStreamParser, type ArtifactInfo } from '../llm/artifact-parser';

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

    // 파일 첨부/문서 docId: 2026-05-19 제거. images (base64) 만 직접 지원.
    const hasImages = Array.isArray(msg.images) && msg.images.length > 0;
    const hasMessage = typeof msg.message === 'string' && msg.message.trim() !== '';

    if (!hasMessage && !hasImages) {
        ws.send(JSON.stringify({ type: 'error', message: '메시지가 필요합니다' }));
        return;
    }

    const { model, nodeId, history, sessionId, anonSessionId } = msg;
    const { images } = msg;
    const message = (msg.message ?? '').trim();

    // 사용자 언어 감지 — 설정에서 선택한 언어를 우선, 없으면 메시지 기반 자동 감지
    const userLangPreference = (typeof msg.language === 'string' && msg.language.trim()) ? msg.language.trim() as SupportedLanguageCode : undefined;
    const detectedLang = detectLanguage(message);
    const userLang = userLangPreference || detectedLang.language;

    // 중단 컨트롤러 생성
    const abortController = new AbortController();
    extWs._abortController = abortController;

    // Phase 7 lifecycle hook — per_chat MCP 서버 spawn.
    // chatId 식별자: 우선 sessionId, 없으면 anonSessionId, 없으면 timestamp.
    const chatHookUserId = extWs._authenticatedUserId !== undefined ? String(extWs._authenticatedUserId) : undefined;
    const chatHookId = sessionId || anonSessionId || `ws-${Date.now()}`;
    if (chatHookUserId) {
        void import('../mcp/lifecycle-hooks').then(m => m.emitChatStart(chatHookUserId, chatHookId)).catch(() => { /* noop */ });
    }

    // catch 블록(B4 디버그 큐)에서 접근하기 위해 try 외부에 선언.
    // try 안에서 실제 값으로 갱신된다.
    let selectedModel = model;
    let validSessionId: string | undefined;
    let tokenCount = 0;
    let partialAssistantResponse = '';

    try {
        // 모델 결정 (자동 선택 또는 사용자 지정)
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

        // 웹 검색: 사용자가 명시적으로 활성화했거나, 시사 관련 질문이 감지된 경우 수행
        const langKeywords = getLocalizedTemplate(CURRENT_EVENTS_KEYWORDS, userLang);
        const allKeywords = [...langKeywords, ...(CURRENT_EVENTS_KEYWORDS['en'] || [])];
        const isCurrentEventsQuery = allKeywords.some(keyword => message?.toLowerCase().includes(keyword.toLowerCase()));
        const userWebSearchEnabled = msg.webSearch === true;
        let webSearchContext = '';

        // pre-chat 웹 검색 게이트: 사용자가 명시적으로 web_search=false를 송신한 경우만 차단.
        // 빈 객체 {} 또는 미지정(undefined)은 허용 — 시사 키워드 자동 검색이 기본 동작이어야 함.
        const userExplicitlyDisabledSearch = msg.enabledTools?.web_search === false;
        if (!userExplicitlyDisabledSearch && (userWebSearchEnabled || isCurrentEventsQuery)) {
            try {
                const { performWebSearch } = await import('../mcp');
                const searchResults = await performWebSearch(message, { maxResults: 5, language: userLang });
                if (searchResults.length > 0) {
                    const tpl = getLocalizedTemplate(WEB_SEARCH_TEMPLATES, userLang);
                    webSearchContext = `\n\n## \uD83D\uDD0D ${tpl.header} (${new Date().toLocaleDateString(tpl.locale)} )\n` +
                        `${tpl.instruction}\n\n` +
                        searchResults.map((r: { title?: string; url?: string; snippet?: string }, i: number) => `[${tpl.sourceLabel} ${i + 1}] ${r.title}\n   URL: ${r.url}\n${r.snippet ? `   ${tpl.contentLabel}: ${r.snippet}\n` : ''}`).join('\n') + '\n';
                }
            } catch (e) {
                log.error('[Chat] 웹 검색 실패:', e);
            }
        }

        // 시사 질의인데 외부 데이터를 얻지 못한 경우(검색 차단·결과 0건·검색 실패 모두 포함)
        // 환각 방지 안전망 메시지를 system prompt 채널(webSearchContext)로 주입.
        if (isCurrentEventsQuery && !webSearchContext) {
            const warning = getStaleDataWarning(userLang);
            webSearchContext = `\n\n## ⚠️ ${warning.header}\n${warning.instruction}\n`;
            log.info(`[Chat] 시사 질의 + 외부 데이터 부재 → 환각 방지 안전망 주입 (lang=${userLang}, explicitlyDisabled=${userExplicitlyDisabledSearch})`);
        }

        // WS 고유: 세션 생성 시 length < 10 체크 (노드 ID와 구별)
        validSessionId = (sessionId && sessionId.length >= 10) ? sessionId : undefined;

        // messageId 생성 (WS 고유: 토큰 스트리밍에 사용)
        const messageId = crypto.randomUUID
            ? crypto.randomUUID()
            : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // 토큰 생성 메트릭 추적 (tokenCount, partialAssistantResponse 는 catch 접근을 위해 try 외부 선언)
        tokenCount = 0;
        let firstTokenTime = 0;
        const generationStartTime = Date.now();
        partialAssistantResponse = '';

        // 토큰 콜백에서 중단 여부 체크 (WS 고유)
        // Artifacts streaming parser (2026-05-26) — token chunk 마다 `<artifact>` XML 태그 incremental 검출.
        // - tokenCallback (아래) 보다 먼저 선언 — TS use-before-declaration 안전.
        // - parser callbacks 가 ws.send 직접 발행 (token / artifact_start/chunk/end).
        // Phase 3 보완 B.3 (2026-05-26): artifact_chunk WS 메시지 폭주 방지 — 토큰 단위 1회/메시지를
        // ID 별 50ms 윈도우로 buffer 후 합쳐서 1회 dispatch. 큰 artifact (~MB) 시 message rate 1/20.
        const ARTIFACT_CHUNK_FLUSH_MS = 50;
        const chunkBuffers = new Map<string, { delta: string; timer: ReturnType<typeof setTimeout> | null }>();
        const streamedArtifactIds = new Set<string>();
        const flushArtifactChunk = (id: string) => {
            const buf = chunkBuffers.get(id);
            if (!buf || !buf.delta) return;
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'artifact_chunk', id, delta: buf.delta, messageId }));
            }
            buf.delta = '';
            if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
        };
        const artifactStreamParser = new ArtifactStreamParser({
            onContent: (delta) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'token', token: delta, messageId }));
                }
            },
            onArtifactStart: (info: ArtifactInfo) => {
                streamedArtifactIds.add(info.id);
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'artifact_start', artifact: info, messageId }));
                }
            },
            onArtifactChunk: (id, delta) => {
                // throttle: 50ms 윈도우에 도착하는 delta 를 합쳐서 한 번에 dispatch
                let buf = chunkBuffers.get(id);
                if (!buf) { buf = { delta: '', timer: null }; chunkBuffers.set(id, buf); }
                buf.delta += delta;
                if (!buf.timer) {
                    buf.timer = setTimeout(() => flushArtifactChunk(id), ARTIFACT_CHUNK_FLUSH_MS);
                }
            },
            onArtifactEnd: (id) => {
                // end 전 미flush 잔여 강제 dispatch
                flushArtifactChunk(id);
                chunkBuffers.delete(id);
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'artifact_end', id, messageId }));
                }
            },
        });

        const tokenCallback = (token: string) => {
            if (abortController.signal.aborted) {
                throw new Error('ABORTED');
            }

            if (tokenCount === 0) {
                firstTokenTime = Date.now();
                const ttfb = firstTokenTime - generationStartTime;
                log.debug(`[Chat] 첫 번째 토큰 생성됨 (TTFB: ${ttfb}ms)`);
            }
            tokenCount++;
            partialAssistantResponse += token;

            // Artifacts (2026-05-26): incremental XML 태그 분리.
            // parser callbacks 가 ws.send 발행 — token 은 'token', artifact 는 'artifact_*'.
            artifactStreamParser.feed(token);
        };

        // ChatRequestHandler.processChat으로 통합 처리
        const result = await ChatRequestHandler.processChat({
            message,
            model: selectedModel,
            nodeId,
            history,
            images,
            sessionId: validSessionId,
            webSearchContext,
            discussionMode: msg.discussionMode === true,
            deepResearchMode: msg.deepResearchMode === true,
            thinkingMode: msg.thinkingMode === true,
            thinkingLevel: (msg.thinkingLevel || 'high') as 'low' | 'medium' | 'high',
            style: msg.style,
            userAgentId: msg.userAgentId,
            // Phase 3.4 (2026-05-26): 메시지 편집 분기 — 새 session 생성 시 부모 추적
            branchFromSessionId: typeof msg.branchFromSessionId === 'string' ? msg.branchFromSessionId : undefined,
            branchFromMessageId: typeof msg.branchFromMessageId === 'string' ? msg.branchFromMessageId : undefined,
            // 사용자가 명시적으로 false 보낼 때만 본문 저장 차단. 미지정/true → 저장 (기본 보존)
            saveHistory: msg.saveHistory !== false,
            // 메모리 학습 — saveHistory 와 독립. 명시 false 만 차단, 기본 활성
            enabledTools: msg.enabledTools,
            userLanguagePreference: userLangPreference,
            userContext,
            clusterManager: cluster,
            abortSignal: abortController.signal,
            onToken: tokenCallback,
            onThinking: (thinking) => {
                if (abortController.signal.aborted) throw new Error('ABORTED');
                ws.send(JSON.stringify({ type: 'thinking', token: thinking, messageId }));
            },
            format: msg.format as import('../llm').FormatOption,
            onAgentSelected: (agent) => ws.send(JSON.stringify({ type: 'agent_selected', agent })),
            onDiscussionProgress: (progress) => ws.send(JSON.stringify({ type: 'discussion_progress', progress })),
            onResearchProgress: (progress) => ws.send(JSON.stringify({ type: 'research_progress', progress })),
            onSkillsActivated: (skillNames) => ws.send(JSON.stringify({ type: 'skills_activated', skillNames })),
            // MCP tool 호출 결과의 resource content 를 frontend 로 emit
            // (예: create_skill → openmake://skill-draft/{id} → chat.js 가 인라인 카드 렌더)
            onMcpToolResult: (event) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'mcp_tool_result',
                        toolName: event.toolName,
                        resources: event.resources,
                        messageId,
                    }));
                }
            },
            // 시스템 이벤트 (자동 토론 활성화 등 메타 알림) — UI 토스트 분리 표시
            onSystemEvent: (event) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'system_event',
                        payload: {
                            type: event.type,
                            message: event.message,
                            metadata: event.metadata,
                        },
                    }));
                }
            },
        });

        // WS 고유: 새 세션 생성 알림
        if (!validSessionId) {
            ws.send(JSON.stringify({ type: 'session_created', sessionId: result.sessionId }));
        }

        const generationDuration = Date.now() - (firstTokenTime || generationStartTime);
        const tokensPerSec = tokenCount > 0 && generationDuration > 0
            ? (tokenCount / (generationDuration / 1000)).toFixed(2)
            : '0.00';
        const ttfb = firstTokenTime > 0 ? firstTokenTime - generationStartTime : -1;

        // 운영 측정용 단일 라인 로그: TTFB + 경로 분기 플래그 + 토큰 처리량.
        // grep 패턴: "[ChatMetrics]" 로 추출, 컬럼 파싱으로 분기별 p50/p95 분석 가능.
        const rm = result.routingMeta;
        log.info(
            `[ChatMetrics] ttfb=${ttfb}ms fp=${rm?.fastPath ? 'Y' : 'N'} ` +
            `agent_bypass=${rm?.agentBypass ? 'Y' : 'N'} cache_hit=${rm?.summaryCacheHit ? 'Y' : 'N'} ` +
            `tokens=${tokenCount} tps=${tokensPerSec} total=${result.responseTime}ms model=${selectedModel}`
        );
        // Artifact parser flush — 닫는 태그 없이 끝난 partial 도 emit (defensive).
        artifactStreamParser.flush();

        // Fallback artifacts (2026-05-26): incremental parser 가 못 잡은 raw code fence 가
        // 후처리에서 추출됐을 수 있음 — request-handler 의 result.artifacts 를 WS 로 발행.
        // 명시적 <artifact> 는 위 스트리밍 parser 가 이미 보냈으므로 중복 replay 하지 않음.
        // 클라이언트는 동일한 artifact_start/chunk/end 시퀀스로 패널 자동 오픈.
        if (result.artifacts && result.artifacts.length > 0 && ws.readyState === ws.OPEN) {
            for (const a of result.artifacts.filter((artifact) => !streamedArtifactIds.has(artifact.id))) {
                ws.send(JSON.stringify({
                    type: 'artifact_start',
                    artifact: { id: a.id, kind: a.kind, title: a.title, lang: a.lang },
                    messageId,
                }));
                ws.send(JSON.stringify({ type: 'artifact_chunk', id: a.id, delta: a.content, messageId }));
                ws.send(JSON.stringify({ type: 'artifact_end', id: a.id, messageId }));
            }
        }

        // Phase 1.F.2 (2026-05-26): cleanedContent 를 done 페이로드에 동봉.
        // 클라이언트가 token 단위로 누적한 raw 본문을 backend 의 placeholder 적용 본문으로
        // reset 하기 위함. artifact 가 없으면 undefined — 변경 없음.
        const cleanedContent = (result.artifacts && result.artifacts.length > 0)
            ? result.response
            : undefined;
        ws.send(JSON.stringify({
            type: 'done',
            messageId,
            metrics: { tokensPerSec, tokenCount },
            ...(cleanedContent !== undefined ? { cleanedContent } : {}),
        }));

    } catch (error: unknown) {
        // 중단 컨트롤러 정리
        extWs._abortController = null;

        // 중단된 경우
        if (error instanceof Error && error.message === 'ABORTED') {
            log.info('[Chat] 사용자에 의해 중단됨');
            // aborted 메시지는 handleAbort에서 이미 전송됨
            return;
        }

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

        const safeSend = (data: ChatWSErrorPayload) => {
            if (ws.readyState === ws.OPEN) {
                try {
                    ws.send(JSON.stringify(data));
                } catch (e) {
                    log.warn('[Chat] WebSocket send failed:', e);
                }
            }
        };

        if (error instanceof ChatRequestError) {
            log.warn('[Chat] 요청 처리 에러:', error.message);
            safeSend({ type: 'error', message: error.message });
        } else if (error instanceof QuotaExceededError) {
            log.warn('[Chat] API 할당량 초과:', error.message);
            safeSend({
                type: 'error',
                message: `⚠️ ${getLocalizedTemplate(WS_ERROR_MESSAGES, userLang).quotaExceeded} (${error.quotaType}). ${error.used}/${error.limit}.`,
                errorType: 'quota_exceeded',
                retryAfter: error.retryAfterSeconds
            });
        } else if (error instanceof KeyExhaustionError) {
            // 🆕 모든 API 키 소진 에러 처리
            log.warn('[Chat] 모든 API 키 소진:', error.message);
            safeSend({
                type: 'error',
                message: error.getDisplayMessage(userLang),
                errorType: 'api_keys_exhausted',
                retryAfter: error.retryAfterSeconds,
                resetTime: error.resetTime.toISOString(),
                totalKeys: error.totalKeys,
                keysInCooldown: error.keysInCooldown
            });
        } else if (error instanceof ProviderError) {
            // 외부 provider(Anthropic/OpenRouter/Ollama) 에러 — 코드별 사용자 친화 메시지로 분류
            // raw upstream 메시지(error.message)는 stack/credential 누출 위험으로 노출하지 않음
            log.warn(`[Chat] 외부 provider 에러 (${error.code}):`, error.message);
            const localizedTable = getLocalizedTemplate(WS_PROVIDER_ERROR_MESSAGES, userLang);
            safeSend({
                type: 'error',
                message: localizedTable[error.code],
                errorType: error.code.toLowerCase(),
            });
        } else {
            log.error('[Chat] 처리 중 오류:', error);
            // 🔒 Phase 2: 내부 에러 상세 누출 방지 — 제네릭 메시지만 전송
            safeSend({ type: 'error', message: getLocalizedTemplate(WS_ERROR_MESSAGES, userLang).genericError });

            // B+ Phase B4: 디버그 자동 보존 — 사용자 saveHistory=false 여도
            // 에러 재현을 위해 본문을 24h 임시 보관 (TTL 후 자동 삭제)
            if (validSessionId && message) {
                const auditUserId = extWs._authenticatedUserId || 'anonymous';
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
                        ws.send(JSON.stringify({
                            type: 'debug_retained',
                            captureId: capture.id,
                            expiresAt: capture.expiresAt.toISOString(),
                            ttlHours: Math.round(expiresInMs / 3600000),
                        }));
                    }
                }).catch(() => {/* 디버그 큐 실패는 사용자 흐름 안 막음 */});
            }
        }
    } finally {
        // 중단 컨트롤러 정리
        extWs._abortController = null;

        // Phase 7 lifecycle hook — per_chat MCP 서버 graceful kill.
        // try/finally 안 보장 — 에러 발생해도 누락 없이 정리 (P7-D4).
        if (chatHookUserId) {
            void import('../mcp/lifecycle-hooks').then(m => m.emitChatEnd(chatHookUserId, chatHookId)).catch(() => { /* noop */ });
        }
    }
}
