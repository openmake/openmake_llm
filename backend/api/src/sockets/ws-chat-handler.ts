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
import { detectLanguage, type SupportedLanguageCode } from '../chat/language-policy';
import { uploadedDocuments } from '../documents/store';

// 다국어 시사 키워드 맵
const CURRENT_EVENTS_KEYWORDS: Record<string, string[]> = {
    ko: ['대통령', '총리', '장관', '현재', '지금', '오늘', '최근', '뉴스', '선거', '정치', '국회', '정부', '탄핵', '취임'],
    en: ['president', 'prime minister', 'minister', 'current', 'today', 'recent', 'news', 'election', 'politics', 'parliament', 'government', 'impeach', 'inaugur'],
    ja: ['大統領', '首相', '大臣', '現在', '今日', '最近', 'ニュース', '選挙', '政治', '国会', '政府'],
    zh: ['总统', '总理', '部长', '现在', '今天', '最近', '新闻', '选举', '政治', '国会', '政府'],
    es: ['presidente', 'primer ministro', 'ministro', 'actual', 'hoy', 'reciente', 'noticias', 'elecciones', 'política', 'parlamento', 'gobierno', 'destitución', 'investidura'],
    de: ['Präsident', 'Premierminister', 'Minister', 'aktuell', 'heute', 'neulich', 'Nachrichten', 'Wahl', 'Politik', 'Parlament', 'Regierung', 'Amtsenthebung', 'Amtseinführung'],
    fr: ['président', 'premier ministre', 'ministre', 'actuel', 'aujourd\'hui', 'récent', 'actualités', 'élections', 'politique', 'parlement', 'gouvernement', 'destitution', 'investiture'],
};

// 다국어 웹 검색 컨텍스트 템플릿
const WEB_SEARCH_TEMPLATES: Record<string, { header: string; instruction: string; sourceLabel: string; contentLabel: string; locale: string }> = {
    ko: { header: '웹 검색 결과', instruction: '다음은 최신 웹 검색 결과입니다. 이 정보를 우선적으로 참고하여 답변하세요:', sourceLabel: '출처', contentLabel: '내용', locale: 'ko-KR' },
    en: { header: 'Web Search Results', instruction: 'Below are the latest web search results. Please prioritize this information in your response:', sourceLabel: 'Source', contentLabel: 'Content', locale: 'en-US' },
    ja: { header: 'ウェブ検索結果', instruction: '以下は最新のウェブ検索結果です。回答の際にこの情報を優先的に参考にしてください:', sourceLabel: '出典', contentLabel: '内容', locale: 'ja-JP' },
    zh: { header: '网络搜索结果', instruction: '以下是最新的网络搜索结果，请优先参考这些信息进行回答:', sourceLabel: '来源', contentLabel: '内容', locale: 'zh-CN' },
    es: { header: 'Resultados de búsqueda web', instruction: 'A continuación se muestran los resultados más recientes de búsqueda web. Por favor, priorice esta información en su respuesta:', sourceLabel: 'Fuente', contentLabel: 'Contenido', locale: 'es-ES' },
    de: { header: 'Websuchergebnisse', instruction: 'Nachfolgend finden Sie die neuesten Websuchergebnisse. Bitte berücksichtigen Sie diese Informationen vorrangig in Ihrer Antwort:', sourceLabel: 'Quelle', contentLabel: 'Inhalt', locale: 'de-DE' },
    fr: { header: 'Résultats de recherche web', instruction: 'Voici les résultats les plus récents de la recherche web. Veuillez donner la priorité à ces informations dans votre réponse :', sourceLabel: 'Source', contentLabel: 'Contenu', locale: 'fr-FR' },
};

// 다국어 에러 메시지 템플릿
const WS_ERROR_MESSAGES: Record<string, { quotaExceeded: string; genericError: string }> = {
    ko: { quotaExceeded: 'API 할당량이 초과되었습니다', genericError: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' },
    en: { quotaExceeded: 'API quota exceeded', genericError: 'An error occurred while processing. Please try again later.' },
    ja: { quotaExceeded: 'API割り当て量を超過しました', genericError: '処理中にエラーが発生しました。しばらくしてからもう一度お試しください。' },
    zh: { quotaExceeded: 'API配额已超出', genericError: '处理过程中发生错误，请稍后重试。' },
    es: { quotaExceeded: 'Se ha superado la cuota de API', genericError: 'Se produjo un error durante el procesamiento. Por favor, inténtelo de nuevo más tarde.' },
    de: { quotaExceeded: 'API-Kontingent überschritten', genericError: 'Bei der Verarbeitung ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.' },
    fr: { quotaExceeded: 'Quota d\'API dépassé', genericError: 'Une erreur est survenue lors du traitement. Veuillez réessayer ultérieurement.' },
};

function getLocalizedTemplate<T>(map: Record<string, T>, lang: string): T {
    return map[lang] || map['en'] || Object.values(map)[0];
}

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

    const hasFiles = Array.isArray(msg.files) && msg.files.length > 0;
    const hasImages = Array.isArray(msg.images) && msg.images.length > 0;
    const hasDoc = typeof msg.docId === 'string' && msg.docId.trim() !== '';
    const hasMessage = typeof msg.message === 'string' && msg.message.trim() !== '';

    if (!hasMessage && !hasFiles && !hasImages && !hasDoc) {
        ws.send(JSON.stringify({ type: 'error', message: '메시지가 필요합니다' }));
        return;
    }

    // 파일만 첨부하고 메시지가 없는 경우 기본 메시지 자동 생성
    if (!hasMessage) {
        const fileNames = msg.files?.map(f => f.name).join(', ') || '첨부 파일';
        msg.message = `첨부된 파일을 분석해주세요: ${fileNames}`;
    }

    const { model, nodeId, history, sessionId, anonSessionId } = msg;
    let { images, docId } = msg;
    const message = (msg.message ?? '').trim();

    // files 배열에서 uploadedDocuments를 조회하여 이미지 base64 및 docId 보강
    if (hasFiles && msg.files) {
        const resolvedImages: string[] = [...(images || [])];
        for (const file of msg.files) {
            const fileDocId = file.id;
            if (!fileDocId) continue;

            const doc = uploadedDocuments.get(fileDocId);
            if (!doc) continue;

            // docId가 아직 없으면 첫 번째 파일의 docId 사용
            if (!docId) {
                docId = fileDocId;
            }

            // 이미지 base64가 있으면 images에 추가 (프론트엔드에서 이미 보낸 것과 중복 방지)
            if (doc.type === 'image' && doc.info?.base64) {
                if (!resolvedImages.includes(doc.info.base64)) {
                    resolvedImages.push(doc.info.base64);
                    log.info(`[Chat] 📎 파일에서 이미지 해석: ${doc.filename}`);
                }
            }
        }
        if (resolvedImages.length > 0) {
            images = resolvedImages;
        }
    }

    // 사용자 언어 감지 — 설정에서 선택한 언어를 우선, 없으면 메시지 기반 자동 감지
    const userLangPreference = (typeof msg.language === 'string' && msg.language.trim()) ? msg.language.trim() as SupportedLanguageCode : undefined;
    const detectedLang = detectLanguage(message);
    const userLang = userLangPreference || detectedLang.language;

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

        // 웹 검색: 사용자가 명시적으로 활성화했거나, 시사 관련 질문이 감지된 경우 수행
        const langKeywords = getLocalizedTemplate(CURRENT_EVENTS_KEYWORDS, userLang);
        const allKeywords = [...langKeywords, ...(CURRENT_EVENTS_KEYWORDS['en'] || [])];
        const isCurrentEventsQuery = allKeywords.some(keyword => message?.toLowerCase().includes(keyword.toLowerCase()));
        const userWebSearchEnabled = msg.webSearch === true;
        let webSearchContext = '';

        // MCP 도구 토글에서 web_search가 비활성화된 경우 pre-chat 웹 검색도 차단
        const mcpWebSearchAllowed = msg.enabledTools === undefined || msg.enabledTools?.web_search === true;
        if (mcpWebSearchAllowed && (userWebSearchEnabled || isCurrentEventsQuery)) {
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

        // WS 고유: 세션 생성 시 length < 10 체크 (노드 ID와 구별)
        const validSessionId = (sessionId && sessionId.length >= 10) ? sessionId : undefined;

        // messageId 생성 (WS 고유: 토큰 스트리밍에 사용)
        const messageId = crypto.randomUUID
            ? crypto.randomUUID()
            : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // 토큰 생성 메트릭 추적
        let tokenCount = 0;
        let firstTokenTime = 0;
        const generationStartTime = Date.now();

        // 토큰 콜백에서 중단 여부 체크 (WS 고유)
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
            userLanguagePreference: userLangPreference,
            userContext,
            clusterManager: cluster,
            abortSignal: abortController.signal,
            onToken: tokenCallback,
            onThinking: (thinking) => {
                if (abortController.signal.aborted) throw new Error('ABORTED');
                ws.send(JSON.stringify({ type: 'thinking', token: thinking, messageId }));
            },
            format: msg.format as import('../ollama/types').FormatOption,
            onAgentSelected: (agent) => ws.send(JSON.stringify({ type: 'agent_selected', agent })),
            onDiscussionProgress: (progress) => ws.send(JSON.stringify({ type: 'discussion_progress', progress })),
            onResearchProgress: (progress) => ws.send(JSON.stringify({ type: 'research_progress', progress })),
            onSkillsActivated: (skillNames) => ws.send(JSON.stringify({ type: 'skills_activated', skillNames })),
        });

        // WS 고유: 새 세션 생성 알림
        if (!validSessionId) {
            ws.send(JSON.stringify({ type: 'session_created', sessionId: result.sessionId }));
        }

        const generationDuration = Date.now() - (firstTokenTime || generationStartTime);
        const tokensPerSec = tokenCount > 0 && generationDuration > 0 
            ? (tokenCount / (generationDuration / 1000)).toFixed(2) 
            : '0.00';
            
        log.info(`[Chat] 생성 완료: ${tokenCount} 토큰, 속도: ${tokensPerSec} tokens/sec`);
        ws.send(JSON.stringify({ type: 'done', messageId, metrics: { tokensPerSec, tokenCount } }));

    } catch (error: unknown) {
        // 중단 컨트롤러 정리
        extWs._abortController = null;

        // 중단된 경우
        if (error instanceof Error && error.message === 'ABORTED') {
            log.info('[Chat] 사용자에 의해 중단됨');
            // aborted 메시지는 handleAbort에서 이미 전송됨
            return;
        }

        const safeSend = (data: any) => {
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
        } else {
            log.error('[Chat] 처리 중 오류:', error);
            // 🔒 Phase 2: 내부 에러 상세 누출 방지 — 제네릭 메시지만 전송
            safeSend({ type: 'error', message: getLocalizedTemplate(WS_ERROR_MESSAGES, userLang).genericError });
        }
    } finally {
        // 중단 컨트롤러 정리
        extWs._abortController = null;
    }
}
