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
import { WS_ERROR_MESSAGES, WS_PROVIDER_ERROR_MESSAGES, getLocalizedTemplate } from './ws-chat-locales';
import { detectLanguage, type SupportedLanguageCode } from '../chat/language-policy';
import { applySlashCommand } from '../chat/slash-command';
import { WS_LIMITS } from '../config/timeouts';
import { ArtifactStreamParser, type ArtifactInfo } from '../llm/artifact-parser';
import { buildFileContext, buildUrlContext, getCachedAttachContext, appendCachedAttachContext } from '../services/chat-service/attach-context';
import { buildWebSearchContext } from '../mcp/web-search/build-search-context';

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

    // 문서 docId: 2026-05-19 제거. images (base64 vision) + files (텍스트 내용/메타) 직접 지원.
    const hasImages = Array.isArray(msg.images) && msg.images.length > 0;
    const hasFiles = Array.isArray(msg.files) && msg.files.length > 0;
    const hasMessage = typeof msg.message === 'string' && msg.message.trim() !== '';

    if (!hasMessage && !hasImages && !hasFiles) {
        ws.send(JSON.stringify({ type: 'error', message: '메시지가 필요합니다' }));
        return;
    }

    const { model, nodeId, history, sessionId, anonSessionId } = msg;
    const { images } = msg;
    // 슬래시 명령(P-4): `/skill-slug ...` 가 active 스킬과 매칭되면 스킬 컨텍스트를 주입.
    // 비슬래시/미매칭/비활성은 원문 그대로(무영향·무비용), 오류는 graceful(원문 유지).
    const slashUserId = extWs._authenticatedUserId !== undefined ? String(extWs._authenticatedUserId) : undefined;
    const message = await applySlashCommand((msg.message ?? '').trim(), { userId: slashUserId });

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
    // LLM 호출 관측(TTFT/TTLT)을 성공·에러 양쪽에서 기록하기 위해 try 외부 선언.
    let firstTokenTime = 0;
    let generationStartTime = 0;

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
            msg.userId as string | undefined,
            anonSessionId,
        );

        // 채팅 레이트 리밋 체크
        const rateLimitError = await checkChatRateLimit(
            extWs._authenticatedUserId,
            userContext.userRole,
            userContext.anonSessionId,
        );
        if (rateLimitError) {
            ws.send(JSON.stringify({ type: 'error', message: rateLimitError }));
            return;
        }

        // 첨부 파일(이미지 외) → LLM 주입용 컨텍스트 (transient — DB 미저장, webSearchContext 와 동급 채널)
        // 레이트 리밋 통과 후 조립 — 거부될 요청에 최대 300k 자 문자열 조립 비용을 쓰지 않는다.
        // 바이너리 문서(PDF/docx/xlsx/pptx 등)는 base64(data)를 텍스트로 추출해 content 를 채운다.
        // (무거운 파서는 첨부가 있을 때만 lazy 로딩)
        if (hasFiles) {
            const { extractAttachedDocuments } = await import('../services/chat-service/doc-extractor');
            await extractAttachedDocuments(msg.files);
        }
        const fileContext = buildFileContext(msg.files);

        // 딥 리서치 파이프라인은 fileContext 를 소비하지 않음 (research 전략은 message 만 사용).
        // 무음 폐기 대신 명시 거부 — 첨부가 반영된 것처럼 보이는 UX 기만 방지 (2026-06-13)
        if (msg.deepResearchMode === true && fileContext) {
            ws.send(JSON.stringify({ type: 'error', message: '딥 리서치 모드에서는 파일 첨부를 지원하지 않습니다. 첨부를 제거하거나 일반 채팅으로 질문해 주세요.' }));
            return;
        }

        // 메시지 내 URL 결정적 사전 분석 (2026-06-13) — 웹검색과 독립 I/O 이므로 병렬 시작.
        // 모델의 web_scrape 도구 호출에만 맡기면 비결정적(미호출 시 환각) — 사전 주입으로 보장.
        // 딥 리서치는 자체 검색·스크래핑 파이프라인이 URL 을 다루므로 사전 분석 생략.
        const urlContextPromise = msg.deepResearchMode === true
            ? Promise.resolve('')
            : buildUrlContext(message);

        // 웹 검색: 사용자가 명시적으로 활성화했거나, 시사 관련 질문이 감지된 경우 수행.
        // 구조화(/structured) 경로와 동일 헬퍼를 공유해 "한 경로만 검색되는" 분기 누락·로직 드리프트를 방지한다.
        // (WS 는 기존 동작 보존을 위해 signal 미전달 — 중단 시 진행 중 검색은 메인 LLM 루프에서 정리.)
        const { webSearchContext } = await buildWebSearchContext({
            message,
            userLang,
            webSearchEnabled: msg.webSearch === true,
            explicitlyDisabled: msg.enabledTools?.web_search === false,
        });

        // URL 사전 분석 결과 합류 (위에서 웹검색과 병렬 시작) — 본문을 fileContext 채널에 합류.
        const urlContext = await urlContextPromise;
        if (urlContext) {
            log.info(`[Chat] URL 사전 분석 주입: ${urlContext.length}자`);
        }
        const attachContext = fileContext + urlContext;

        // WS 고유: 세션 생성 시 length < 10 체크 (노드 ID와 구별)
        validSessionId = (sessionId && sessionId.length >= 10) ? sessionId : undefined;

        // 멀티턴 재주입 (2026-06-13): fileContext 는 transient(DB 미저장)라 다음 턴 히스토리에
        // 없음 — 세션 캐시의 이전 턴 첨부/링크 컨텍스트를 앞에 합류해 후속 질문 근거를 유지.
        // 딥 리서치는 fileContext 미소비라 제외.
        const cachedAttachContext = (validSessionId && msg.deepResearchMode !== true)
            ? getCachedAttachContext(validSessionId)
            : '';
        if (cachedAttachContext) {
            log.info(`[Chat] 이전 턴 첨부 컨텍스트 재주입: ${cachedAttachContext.length}자`);
        }
        const effectiveAttachContext = cachedAttachContext + attachContext;

        // messageId 생성 (WS 고유: 토큰 스트리밍에 사용)
        const messageId = crypto.randomUUID
            ? crypto.randomUUID()
            : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // 토큰 생성 메트릭 추적 (tokenCount, partialAssistantResponse 는 catch 접근을 위해 try 외부 선언)
        tokenCount = 0;
        firstTokenTime = 0;
        generationStartTime = Date.now();
        partialAssistantResponse = '';

        // 토큰 콜백에서 중단 여부 체크 (WS 고유)
        // Artifacts streaming parser (2026-05-26) — token chunk 마다 `<artifact>` XML 태그 incremental 검출.
        // - tokenCallback (아래) 보다 먼저 선언 — TS use-before-declaration 안전.
        // - parser callbacks 가 ws.send 직접 발행 (token / artifact_start/chunk/end).
        // Phase 3 보완 B.3 (2026-05-26): artifact_chunk WS 메시지 폭주 방지 — 토큰 단위 1회/메시지를
        // ID 별 throttle 윈도우(WS_LIMITS.ARTIFACT_CHUNK_FLUSH_MS)로 buffer 후 합쳐서 1회 dispatch.
        const ARTIFACT_CHUNK_FLUSH_MS = WS_LIMITS.ARTIFACT_CHUNK_FLUSH_MS;
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
            fileContext: effectiveAttachContext || undefined,
            discussionMode: msg.discussionMode === true,
            deepResearchMode: msg.deepResearchMode === true,
            imageMode: msg.imageMode === true,
            artifactMode: msg.artifactMode === true,
            thinkingMode: msg.thinkingMode === true,
            thinkingLevel: (msg.thinkingLevel || 'high') as 'low' | 'medium' | 'high',
            style: msg.style,
            userAgentId: msg.userAgentId,
            // Phase 3.4 (2026-05-26): 메시지 편집 분기 — 새 session 생성 시 부모 추적
            branchFromSessionId: typeof msg.branchFromSessionId === 'string' ? msg.branchFromSessionId : undefined,
            branchFromMessageId: typeof msg.branchFromMessageId === 'string' ? msg.branchFromMessageId : undefined,
            // 사용자가 명시적으로 false 보낼 때만 본문 저장 차단. 미지정/true → 저장 (기본 보존)
            saveHistory: msg.saveHistory !== false,
            // 저장된 장기 메모리 주입 여부 — saveHistory 와 독립. 명시 false 만 차단, 기본 활성.
            memoryLearning: msg.memoryLearning !== false,
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
            // 생각 요약 헤드라인 (중간·최종) — request-handler 의 요약 세션이 발행
            onThinkingSummary: (summary) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'thinking_summary', summary, messageId }));
                }
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
            // MCP tool 호출 시작 알림 — frontend "🔍 {도구} 실행 중" 진행 표시
            // (도구 실행 중 "생각 중..." 이 멈춘 듯 보이는 혼선 해소)
            onMcpToolStart: (event) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'mcp_tool_start',
                        toolName: event.toolName,
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

        // 이번 턴의 새 첨부 컨텍스트를 세션 캐시에 누적 — 첫 턴은 result.sessionId 로
        // 새 세션 ID 확보 후 저장. saveHistory=false 면 서버 보관 자체를 생략 (프라이버시).
        if (attachContext && msg.saveHistory !== false) {
            const cacheSessionId = validSessionId || result.sessionId;
            if (cacheSessionId) appendCachedAttachContext(cacheSessionId, attachContext);
        }

        const generationDuration = Date.now() - (firstTokenTime || generationStartTime);
        const tokensPerSec = tokenCount > 0 && generationDuration > 0
            ? (tokenCount / (generationDuration / 1000)).toFixed(2)
            : '0.00';
        const ttfb = firstTokenTime > 0 ? firstTokenTime - generationStartTime : -1;

        // 운영 측정용 단일 라인 로그: TTFB + 경로 분기 플래그 + 토큰 처리량.
        // grep 패턴: "[ChatMetrics]" 로 추출, 컬럼 파싱으로 분기별 p50/p95 분석 가능.
        const rm = result.routingMeta;
        // 평문(하위호환 grep) + 구조화 meta(집계/대시보드용 — 성공/에러 통일 스키마 event=chat_llm_call).
        log.info(
            `[ChatMetrics] ttfb=${ttfb}ms fp=${rm?.fastPath ? 'Y' : 'N'} ` +
            `agent_bypass=${rm?.agentBypass ? 'Y' : 'N'} cache_hit=${rm?.summaryCacheHit ? 'Y' : 'N'} ` +
            `tokens=${tokenCount} tps=${tokensPerSec} total=${result.responseTime}ms model=${selectedModel}`,
            {
                event: 'chat_llm_call',
                status: 'success',
                model: selectedModel,
                ttft_ms: ttfb,
                ttlt_ms: generationDuration,
                total_ms: result.responseTime,
                tokens: tokenCount,
                tps: Number(tokensPerSec),
                fast_path: !!rm?.fastPath,
                agent_bypass: !!rm?.agentBypass,
                summary_cache_hit: !!rm?.summaryCacheHit,
            },
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

        // 구조화 LLM 호출 이벤트 (성공 경로와 통일 스키마 event=chat_llm_call — 에러 가시성/집계용).
        // firstTokenTime>0 이면 토큰 수신 중 실패, 0 이면 첫 토큰 전(요청/연결 단계) 실패.
        log.warn('[ChatMetrics] LLM 호출 실패', {
            event: 'chat_llm_call',
            status: 'error',
            model: selectedModel,
            ttft_ms: firstTokenTime > 0 ? firstTokenTime - generationStartTime : -1,
            tokens: tokenCount,
            error_type: error instanceof Error ? error.constructor.name : 'Unknown',
        });

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
            // 외부 provider(Anthropic/OpenRouter) 에러 — 코드별 사용자 친화 메시지로 분류
            // raw upstream 메시지(error.message)는 stack/credential 누출 위험으로 노출하지 않음
            const causeDetail = error.cause instanceof Error
                ? `${error.cause.message}${(error.cause as { status?: number }).status ? ` [status=${(error.cause as { status?: number }).status}]` : ''}`
                : (error.cause ? JSON.stringify(error.cause).slice(0, 300) : '');
            log.warn(`[Chat] 외부 provider 에러 (${error.code}): ${error.message} | cause: ${causeDetail}`);
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
