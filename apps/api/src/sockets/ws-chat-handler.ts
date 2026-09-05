/**
 * WebSocket 채팅 메시지 처리
 * ChatRequestHandler를 통한 AI 채팅 스트리밍, 에러 핸들링을 담당합니다.
 * @module sockets/ws-chat-handler
 */
import { WebSocket } from 'ws';
import * as crypto from 'crypto';
import { ClusterManager } from '../cluster/manager';
import { selectOptimalModel } from '../chat/model-selector';
import { dispatchAnswerVerification } from '../services/chat-service/answer-verifier';
import { resolveCleanedContent } from './ws-chat-completion';
import { ChatRequestHandler, ChatRequestError } from '../chat/request-handler';
import { enqueueDebugCapture, DEBUG_QUEUE_TTL_MS } from '../data/conversation-debug-queue';
import { QuotaExceededError } from '../errors/quota-exceeded.error';
import { KeyExhaustionError } from '../errors/key-exhaustion.error';
import { ProviderError } from '../providers/provider-errors';
import { checkChatRateLimit } from '../middlewares/chat-rate-limiter';
import { createLogger } from '../utils/logger';
import { logChatSuccessMetrics } from './chat-metrics-log';
import { WSMessage, ExtendedWebSocket } from './ws-types';
import { WS_ERROR_MESSAGES, WS_PROVIDER_ERROR_MESSAGES, getLocalizedTemplate } from './ws-chat-locales';
import { detectLanguage, type SupportedLanguageCode } from '../chat/language-policy';
import { applySlashCommand, mergeActivatedSkillNames, languageDetectionInput } from '../chat/slash-command';
import { WS_LIMITS } from '../config/timeouts';
import { FILE_ATTACH_LIMITS } from '../config/runtime-limits';
import { ArtifactStreamParser, type ArtifactInfo } from '../llm/artifact-parser';
import { buildFileContext, buildUrlContext, getCachedAttachContext, appendCachedAttachContext } from '../services/chat-service/attach-context';
import type { PdfVisionResult } from '../services/chat-service/pdf-vision';
import { saveAssistantMessage } from '../chat/request-persistence';
import { buildWebSearchContext } from '../mcp/web-search/build-search-context';
import { getInFlightStreamRegistry, resolveStreamKey } from './ws-stream-registry';

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

    // 첨부 개수 상한 — REST/agent-task 스키마(FILE_ATTACH_LIMITS)와 동일 계약을 WS 채팅에도 적용한다.
    // WS 는 Zod 검증을 거치지 않아 개수 캡이 비어 있었고, 대량 배열로 파이프라인 자원을 소모할 수 있었다.
    if (hasImages && (msg.images as unknown[]).length > FILE_ATTACH_LIMITS.MAX_IMAGES) {
        ws.send(JSON.stringify({ type: 'error', message: `이미지는 최대 ${FILE_ATTACH_LIMITS.MAX_IMAGES}개까지 첨부할 수 있습니다` }));
        return;
    }
    if (hasFiles && (msg.files as unknown[]).length > FILE_ATTACH_LIMITS.MAX_FILES) {
        ws.send(JSON.stringify({ type: 'error', message: `파일은 최대 ${FILE_ATTACH_LIMITS.MAX_FILES}개까지 첨부할 수 있습니다` }));
        return;
    }

    const { model, nodeId, history, sessionId, anonSessionId } = msg;
    const { images } = msg;
    // 슬래시 명령(P-4): `/skill-slug ...` 가 active 스킬과 매칭되면 스킬 컨텍스트를 주입.
    // 비슬래시/미매칭/비활성은 원문 그대로(무영향·무비용), 오류는 graceful(원문 유지).
    const slashUserId = extWs._authenticatedUserId !== undefined ? String(extWs._authenticatedUserId) : undefined;
    const explicitSkillNames: string[] = [];
    const rawMessage = (msg.message ?? '').trim(); // 사전 웹검색·URL 분석용 원문 — slash-expansion-not-search-query.test.ts
    const message = await applySlashCommand(rawMessage, {
        userId: slashUserId,
        onSkillApplied: (skillName) => explicitSkillNames.push(skillName),
    });

    // 사용자 언어 감지 — 설정에서 선택한 언어를 우선, 없으면 메시지 기반 자동 감지
    const userLangPreference = (typeof msg.language === 'string' && msg.language.trim()) ? msg.language.trim() as SupportedLanguageCode : undefined;
    const detectedLang = detectLanguage(languageDetectionInput(rawMessage, message));
    const userLang = userLangPreference || detectedLang.language;

    // NotebookLM 노트북 컨텍스트 — 여기서 message 에 주입하지 않는다(주입 시 대화 저장·
    // 재로드 말풍선·사이드바 제목에 프리픽스가 남음). message-pipeline 이 LLM 전용
    // enhancedMessage 채널에 주입(prompts/notebook-context)하도록 요청 필드로만 전달.
    const nb = msg.notebook;
    const notebookRef = (nb && typeof nb.id === 'string' && nb.id.trim() && typeof nb.title === 'string')
        ? { id: nb.id.trim().slice(0, 64), title: nb.title }
        : undefined;

    // 중단 컨트롤러 생성 + 이어받기 레지스트리 등록 — 소켓이 끊겨도 생성은 계속되고(유예),
    // 이후 모든 클라이언트 이벤트는 out() 을 거쳐 attached 소켓으로 가거나 detach 버퍼에 쌓인다.
    const abortController = new AbortController();
    extWs._abortController = abortController;
    const streamRegistry = getInFlightStreamRegistry();
    const streamKey = resolveStreamKey(extWs, anonSessionId);
    const streamEntry = streamKey ? streamRegistry.open(streamKey, extWs, abortController) : null;
    const out = (payload: Record<string, unknown>): void => {
        if (streamEntry) streamRegistry.send(streamEntry, payload);
        else if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
    };

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
            extWs._clientIp,
        );
        if (rateLimitError) {
            out({ type: 'error', message: rateLimitError });
            return;
        }
        // 첨부 파일(이미지 외) → LLM 주입용 컨텍스트 (transient — DB 미저장, webSearchContext 와 동급 채널)
        // 레이트 리밋 통과 후 조립 — 거부될 요청에 최대 300k 자 문자열 조립 비용을 쓰지 않는다.
        // 바이너리 문서(PDF/docx/xlsx/pptx 등)는 base64(data)를 텍스트로 추출해 content 를 채운다.
        // (무거운 파서는 첨부가 있을 때만 lazy 로딩)
        // PDF 하이브리드(2026-08-19): 추출(data 소거) 전 앞쪽 페이지 vision 렌더 주입 — 특수 모드(딥리서치·이미지생성·토론) 제외
        let pdfVision: PdfVisionResult = { images: [], note: '' };
        if (hasFiles && msg.deepResearchMode !== true && msg.imageMode !== true && msg.discussionMode !== true) {
            const { buildPdfVisionAttachment } = await import('../services/chat-service/pdf-vision');
            pdfVision = await buildPdfVisionAttachment(msg.files, images?.length ?? 0);
        }
        if (hasFiles) {
            const { extractAttachedDocuments } = await import('../services/chat-service/doc-extractor');
            await extractAttachedDocuments(msg.files);
        }
        const fileContext = buildFileContext(msg.files);

        // 딥 리서치 파이프라인은 fileContext 를 소비하지 않음 (research 전략은 message 만 사용).
        // 무음 폐기 대신 명시 거부 — 첨부가 반영된 것처럼 보이는 UX 기만 방지 (2026-06-13)
        if (msg.deepResearchMode === true && fileContext) {
            out({ type: 'error', message: '딥 리서치 모드에서는 파일 첨부를 지원하지 않습니다. 첨부를 제거하거나 일반 채팅으로 질문해 주세요.' });
            return;
        }

        // 메시지 내 URL 결정적 사전 분석 (2026-06-13) — 웹검색과 독립 I/O 이므로 병렬 시작.
        // 모델의 web_scrape 도구 호출에만 맡기면 비결정적(미호출 시 환각) — 사전 주입으로 보장.
        // 딥 리서치는 자체 검색·스크래핑 파이프라인이 URL 을 다루므로 사전 분석 생략.
        const urlContextPromise = msg.deepResearchMode === true
            ? Promise.resolve('')
            : buildUrlContext(rawMessage);

        // 웹 검색: 사용자가 명시적으로 활성화했거나, 시사 관련 질문이 감지된 경우 수행.
        // 구조화(/structured) 경로와 동일 헬퍼를 공유해 "한 경로만 검색되는" 분기 누락·로직 드리프트를 방지한다.
        // (WS 는 기존 동작 보존을 위해 signal 미전달 — 중단 시 진행 중 검색은 메인 LLM 루프에서 정리.)
        const { webSearchContext } = await buildWebSearchContext({
            message: rawMessage,
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
            out({ type: 'artifact_chunk', id, delta: buf.delta, messageId });
            buf.delta = '';
            if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
        };
        const artifactStreamParser = new ArtifactStreamParser({
            onContent: (delta) => {
                out({ type: 'token', token: delta, messageId });
            },
            onArtifactStart: (info: ArtifactInfo) => {
                streamedArtifactIds.add(info.id);
                out({ type: 'artifact_start', artifact: info, messageId });
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
                out({ type: 'artifact_end', id, messageId });
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

        if (explicitSkillNames.length > 0) {
            out({ type: 'skills_activated', skillNames: explicitSkillNames });
        }

        // ChatRequestHandler.processChat으로 통합 처리
        const result = await ChatRequestHandler.processChat({
            message, originalMessage: rawMessage,
            model: selectedModel,
            nodeId,
            history,
            images: pdfVision.images.length > 0 ? [...(images ?? []), ...pdfVision.images] : images,
            sessionId: validSessionId,
            webSearchContext,
            fileContext: (effectiveAttachContext + pdfVision.note) || undefined,
            discussionMode: msg.discussionMode === true,
            deepResearchMode: msg.deepResearchMode === true,
            imageMode: msg.imageMode === true,
            artifactMode: msg.artifactMode === true,
            thinkingMode: msg.thinkingMode === true,
            thinkingLevel: (msg.thinkingLevel || 'medium') as 'low' | 'medium' | 'high',
            style: msg.style,
            userAgentId: msg.userAgentId,
            // 이 턴에 발급한 스트리밍 messageId — assistant 행에 남겨 피드백 신호를
            // 해당 응답(및 담당 에이전트)에 되짚을 수 있게 한다(자가개선 F2 귀속).
            clientMessageId: messageId,
            // 좁은 화면 클라이언트(iOS 앱) — 답변 형식에 폭 제약만 덧붙인다
            client: msg.client === 'ios' ? 'ios' : undefined,
            // Phase 3.4 (2026-05-26): 메시지 편집 분기 — 새 session 생성 시 부모 추적
            branchFromSessionId: typeof msg.branchFromSessionId === 'string' ? msg.branchFromSessionId : undefined,
            branchFromMessageId: typeof msg.branchFromMessageId === 'string' ? msg.branchFromMessageId : undefined,
            // 사용자가 명시적으로 false 보낼 때만 본문 저장 차단. 미지정/true → 저장 (기본 보존)
            saveHistory: msg.saveHistory !== false,
            // 저장된 장기 메모리 주입 여부 — saveHistory 와 독립. 명시 false 만 차단, 기본 활성.
            memoryLearning: msg.memoryLearning !== false,
            enabledTools: msg.enabledTools,
            notebook: notebookRef,
            userLanguagePreference: userLangPreference,
            // 기기 GPS 위치 (옵트인) — 범위 밖/비정상 값은 무시 (fail-safe)
            userLocation: (() => {
                const loc = (msg as { userLocation?: { lat?: unknown; lng?: unknown } }).userLocation;
                if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return undefined;
                if (loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180) return undefined;
                return { lat: loc.lat, lng: loc.lng };
            })(),
            userContext,
            clusterManager: cluster,
            abortSignal: abortController.signal,
            onToken: tokenCallback,
            onThinking: (thinking) => {
                if (abortController.signal.aborted) throw new Error('ABORTED');
                out({ type: 'thinking', token: thinking, messageId });
            },
            // 생각 요약 헤드라인 (중간·최종) — request-handler 의 요약 세션이 발행
            onThinkingSummary: (summary) => {
                out({ type: 'thinking_summary', summary, messageId });
            },
            format: msg.format as import('../llm').FormatOption,
            onAgentSelected: (agent) => out({ type: 'agent_selected', agent }),
            onDiscussionProgress: (progress) => out({ type: 'discussion_progress', progress }),
            onResearchProgress: (progress) => out({ type: 'research_progress', progress }),
            onSkillsActivated: (skillNames) => out({
                type: 'skills_activated',
                skillNames: mergeActivatedSkillNames(explicitSkillNames, skillNames),
            }),
            // MCP tool 호출 결과의 resource content 를 frontend 로 emit
            // (예: create_skill → openmake://skill-draft/{id} → chat.js 가 인라인 카드 렌더)
            onMcpToolResult: (event) => {
                out({
                    type: 'mcp_tool_result',
                    toolName: event.toolName,
                    resources: event.resources,
                    messageId,
                });
            },
            // MCP tool 호출 시작 알림 — frontend "🔍 {도구} 실행 중" 진행 표시
            // (도구 실행 중 "생각 중..." 이 멈춘 듯 보이는 혼선 해소)
            onMcpToolStart: (event) => {
                out({
                    type: 'mcp_tool_start',
                    toolName: event.toolName,
                    messageId,
                });
            },
            // 시스템 이벤트 (자동 토론 활성화 등 메타 알림) — UI 토스트 분리 표시
            onSystemEvent: (event) => {
                out({
                    type: 'system_event',
                    payload: {
                        type: event.type,
                        message: event.message,
                        metadata: event.metadata,
                    },
                });
            },
        });

        // WS 고유: 새 세션 생성 알림
        if (!validSessionId) {
            out({ type: 'session_created', sessionId: result.sessionId });
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

        // model 은 **실제로 답한 모델**(result.model = servedModel)을 쓴다 — 요청 모델을 쓰면
        // 외부 provider 폴백(429·401 등) 시 로그가 chatgpt 로 남아 실제 응답(로컬)과 어긋난다.
        logChatSuccessMetrics(log, {
            model: result.model || selectedModel,
            ttfbMs: ttfb,
            generationMs: generationDuration,
            totalMs: result.responseTime,
            tokens: tokenCount,
            tokensPerSec,
            routingMeta: result.routingMeta,
        });
        // Artifact parser flush — 닫는 태그 없이 끝난 partial 도 emit (defensive).
        artifactStreamParser.flush();

        // Fallback artifacts (2026-05-26): incremental parser 가 못 잡은 raw code fence 가
        // 후처리에서 추출됐을 수 있음 — request-handler 의 result.artifacts 를 WS 로 발행.
        // 명시적 <artifact> 는 위 스트리밍 parser 가 이미 보냈으므로 중복 replay 하지 않음.
        // 클라이언트는 동일한 artifact_start/chunk/end 시퀀스로 패널 자동 오픈.
        if (result.artifacts && result.artifacts.length > 0) {
            for (const a of result.artifacts.filter((artifact) => !streamedArtifactIds.has(artifact.id))) {
                out({
                    type: 'artifact_start',
                    artifact: { id: a.id, kind: a.kind, title: a.title, lang: a.lang },
                    messageId,
                });
                out({ type: 'artifact_chunk', id: a.id, delta: a.content, messageId });
                out({ type: 'artifact_end', id: a.id, messageId });
            }
        }

        const cleanedContent = resolveCleanedContent({
            artifactCount: result.artifacts?.length ?? 0,
            finalResponse: result.response,
            streamedResponse: partialAssistantResponse,
        });
        out({
            type: 'done',
            messageId,
            metrics: { tokensPerSec, tokenCount },
            ...(cleanedContent !== undefined ? { cleanedContent } : {}),
        });

        // 답변 검증 (선택) — done 이후 judge 모델이 1회 점검하고 **지적만** 보낸다(자동 수정 없음).
        dispatchAnswerVerification({
            requested: msg.verifyAnswer === true,
            userMessage: typeof msg.message === 'string' ? msg.message : '',
            answer: cleanedContent ?? result.response ?? partialAssistantResponse ?? '',
            ...(extWs._authenticatedUserId ? { userId: extWs._authenticatedUserId } : {}),
            ...(userLangPreference ? { userLanguage: userLangPreference } : {}),
        }, (issues) => {
            out({ type: 'answer_verification', issues, messageId });
        });

    } catch (error: unknown) {
        // 중단 컨트롤러 정리
        extWs._abortController = null;

        // 중단된 경우
        if (error instanceof Error && error.message === 'ABORTED') {
            log.info('[Chat] 사용자에 의해 중단됨');
            // aborted 메시지는 handleAbort에서 이미 전송됨
            return;
        }

        // 부분 응답 보존 (2026-08-03): 스트림 도중 실패 시 이미 화면에 나간 partial 을
        // 히스토리에 저장 — 사용자가 본 내용이 새로고침으로 소실되는 단절을 막는다.
        // saveHistory=false(프라이버시)는 기존 정책대로 미저장. 신규 세션 첫 턴은
        // 세션 id 를 모르는 채 실패한 경우라 제외(사용자 메시지도 새 세션에 있음).
        if (partialAssistantResponse.length > 0 && validSessionId && msg.saveHistory !== false) {
            const partialNotice = getLocalizedTemplate(WS_ERROR_MESSAGES, userLang).partialInterrupted;
            const partialAuditUserId = extWs._authenticatedUserId || anonSessionId || 'anonymous';
            void saveAssistantMessage(
                validSessionId,
                partialAuditUserId,
                `${partialAssistantResponse}\n\n> ⚠️ ${partialNotice}`,
                selectedModel,
                Date.now() - generationStartTime,
                true,
            ).catch((e) => log.warn('[Chat] 부분 응답 저장 실패:', e));
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
    } finally {
        // 중단 컨트롤러 정리 + 레지스트리 정리(detach 로 끝났으면 결과 스냅샷 보존)
        extWs._abortController = null;
        if (streamEntry) streamRegistry.close(streamEntry);

        // Phase 7 lifecycle hook — per_chat MCP 서버 graceful kill.
        // try/finally 안 보장 — 에러 발생해도 누락 없이 정리 (P7-D4).
        if (chatHookUserId) {
            void import('../mcp/lifecycle-hooks').then(m => m.emitChatEnd(chatHookUserId, chatHookId)).catch(() => { /* noop */ });
        }
    }
}
