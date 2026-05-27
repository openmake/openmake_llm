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
import { ProviderError, type ProviderErrorCode } from '../providers/provider-errors';
import { checkChatRateLimit } from '../middlewares/chat-rate-limiter';
import { createLogger } from '../utils/logger';
import { WSMessage, ExtendedWebSocket } from './ws-types';
import { detectLanguage, type SupportedLanguageCode } from '../chat/language-policy';
import { getStaleDataWarning } from '../config/stale-data-warning';
import { ArtifactStreamParser, type ArtifactInfo } from '../llm/artifact-parser';

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

// 외부 provider(Anthropic/OpenRouter/Ollama 등) ProviderError 다국어 메시지
// raw upstream 메시지를 그대로 노출하면 stack/credential 누출 위험 → 코드별 사전 정의 텍스트만 전달
const WS_PROVIDER_ERROR_MESSAGES: Record<string, Record<ProviderErrorCode, string>> = {
    ko: {
        GUEST_NOT_ALLOWED: '이 모델은 로그인이 필요합니다. 로그인 후 다시 시도해주세요.',
        MISSING_API_KEY: '외부 LLM 제공자의 API 키가 설정되지 않았습니다. 관리자에게 문의하거나 다른 모델을 선택하세요.',
        INVALID_API_KEY: '외부 LLM 제공자의 API 키 인증에 실패했습니다. 관리자에게 문의하세요.',
        QUOTA_EXCEEDED: '외부 LLM 제공자의 사용량 한도가 초과되었습니다. 잠시 후 다시 시도하거나 다른 모델을 선택하세요.',
        INSUFFICIENT_CREDIT: '외부 LLM 제공자의 잔액이 부족합니다. 관리자에게 문의하거나 다른 모델을 선택하세요.',
        MODEL_NOT_FOUND: '선택한 모델을 외부 LLM 제공자에서 찾을 수 없습니다. 모델 목록을 새로고침하거나 다른 모델을 선택하세요.',
        NOT_SUPPORTED: '선택한 모델이 이 기능을 지원하지 않습니다. 다른 모델을 시도해주세요.',
        UPSTREAM_ERROR: '외부 LLM 제공자에서 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        INVALID_MODEL_ID: '모델 식별자 형식이 올바르지 않습니다. 모델 목록에서 다시 선택해주세요.',
    },
    en: {
        GUEST_NOT_ALLOWED: 'This model requires authentication. Please log in and try again.',
        MISSING_API_KEY: 'The API key for the external LLM provider is not configured. Please contact your administrator or select a different model.',
        INVALID_API_KEY: 'Authentication with the external LLM provider failed. Please contact your administrator.',
        QUOTA_EXCEEDED: 'The usage limit for the external LLM provider has been exceeded. Please try again later or select a different model.',
        INSUFFICIENT_CREDIT: 'The external LLM provider has insufficient credit. Please contact your administrator or select a different model.',
        MODEL_NOT_FOUND: 'The selected model was not found at the external LLM provider. Please refresh the model list or select a different model.',
        NOT_SUPPORTED: 'The selected model does not support this feature. Please try a different model.',
        UPSTREAM_ERROR: 'A temporary error occurred at the external LLM provider. Please try again later.',
        INVALID_MODEL_ID: 'The model identifier format is invalid. Please reselect from the model list.',
    },
    ja: {
        GUEST_NOT_ALLOWED: 'このモデルはログインが必要です。ログイン後に再度お試しください。',
        MISSING_API_KEY: '外部LLMプロバイダーのAPIキーが設定されていません。管理者にお問い合わせいただくか、別のモデルを選択してください。',
        INVALID_API_KEY: '外部LLMプロバイダーのAPIキー認証に失敗しました。管理者にお問い合わせください。',
        QUOTA_EXCEEDED: '外部LLMプロバイダーの使用上限を超過しました。しばらくしてから再度お試しいただくか、別のモデルを選択してください。',
        INSUFFICIENT_CREDIT: '外部LLMプロバイダーの残高が不足しています。管理者にお問い合わせいただくか、別のモデルを選択してください。',
        MODEL_NOT_FOUND: '選択したモデルが外部LLMプロバイダーで見つかりません。モデル一覧を更新するか、別のモデルを選択してください。',
        NOT_SUPPORTED: '選択したモデルはこの機能をサポートしていません。別のモデルをお試しください。',
        UPSTREAM_ERROR: '外部LLMプロバイダーで一時的なエラーが発生しました。しばらくしてから再度お試しください。',
        INVALID_MODEL_ID: 'モデル識別子の形式が正しくありません。モデル一覧から再選択してください。',
    },
    zh: {
        GUEST_NOT_ALLOWED: '此模型需要登录。请登录后重试。',
        MISSING_API_KEY: '未配置外部LLM提供商的API密钥。请联系管理员或选择其他模型。',
        INVALID_API_KEY: '外部LLM提供商的API密钥认证失败。请联系管理员。',
        QUOTA_EXCEEDED: '已超过外部LLM提供商的使用限制。请稍后重试或选择其他模型。',
        INSUFFICIENT_CREDIT: '外部LLM提供商的余额不足。请联系管理员或选择其他模型。',
        MODEL_NOT_FOUND: '外部LLM提供商找不到所选模型。请刷新模型列表或选择其他模型。',
        NOT_SUPPORTED: '所选模型不支持此功能。请尝试其他模型。',
        UPSTREAM_ERROR: '外部LLM提供商发生临时错误。请稍后重试。',
        INVALID_MODEL_ID: '模型标识符格式无效。请从模型列表中重新选择。',
    },
    es: {
        GUEST_NOT_ALLOWED: 'Este modelo requiere autenticación. Por favor, inicie sesión e inténtelo de nuevo.',
        MISSING_API_KEY: 'La clave API del proveedor LLM externo no está configurada. Por favor, contacte al administrador o seleccione un modelo diferente.',
        INVALID_API_KEY: 'La autenticación con el proveedor LLM externo falló. Por favor, contacte al administrador.',
        QUOTA_EXCEEDED: 'Se ha superado el límite de uso del proveedor LLM externo. Por favor, inténtelo más tarde o seleccione un modelo diferente.',
        INSUFFICIENT_CREDIT: 'El proveedor LLM externo tiene saldo insuficiente. Por favor, contacte al administrador o seleccione un modelo diferente.',
        MODEL_NOT_FOUND: 'El modelo seleccionado no se encontró en el proveedor LLM externo. Por favor, actualice la lista de modelos o seleccione un modelo diferente.',
        NOT_SUPPORTED: 'El modelo seleccionado no admite esta función. Por favor, pruebe un modelo diferente.',
        UPSTREAM_ERROR: 'Se produjo un error temporal en el proveedor LLM externo. Por favor, inténtelo de nuevo más tarde.',
        INVALID_MODEL_ID: 'El formato del identificador del modelo no es válido. Por favor, vuelva a seleccionar de la lista de modelos.',
    },
    de: {
        GUEST_NOT_ALLOWED: 'Dieses Modell erfordert eine Anmeldung. Bitte melden Sie sich an und versuchen Sie es erneut.',
        MISSING_API_KEY: 'Der API-Schlüssel des externen LLM-Anbieters ist nicht konfiguriert. Bitte wenden Sie sich an den Administrator oder wählen Sie ein anderes Modell.',
        INVALID_API_KEY: 'Die Authentifizierung beim externen LLM-Anbieter ist fehlgeschlagen. Bitte wenden Sie sich an den Administrator.',
        QUOTA_EXCEEDED: 'Das Nutzungslimit des externen LLM-Anbieters wurde überschritten. Bitte versuchen Sie es später erneut oder wählen Sie ein anderes Modell.',
        INSUFFICIENT_CREDIT: 'Der externe LLM-Anbieter verfügt über unzureichendes Guthaben. Bitte wenden Sie sich an den Administrator oder wählen Sie ein anderes Modell.',
        MODEL_NOT_FOUND: 'Das ausgewählte Modell wurde beim externen LLM-Anbieter nicht gefunden. Bitte aktualisieren Sie die Modellliste oder wählen Sie ein anderes Modell.',
        NOT_SUPPORTED: 'Das ausgewählte Modell unterstützt diese Funktion nicht. Bitte versuchen Sie ein anderes Modell.',
        UPSTREAM_ERROR: 'Beim externen LLM-Anbieter ist ein vorübergehender Fehler aufgetreten. Bitte versuchen Sie es später erneut.',
        INVALID_MODEL_ID: 'Das Format der Modellkennung ist ungültig. Bitte wählen Sie aus der Modellliste neu aus.',
    },
    fr: {
        GUEST_NOT_ALLOWED: 'Ce modèle nécessite une authentification. Veuillez vous connecter et réessayer.',
        MISSING_API_KEY: 'La clé API du fournisseur LLM externe n\'est pas configurée. Veuillez contacter l\'administrateur ou sélectionner un autre modèle.',
        INVALID_API_KEY: 'L\'authentification auprès du fournisseur LLM externe a échoué. Veuillez contacter l\'administrateur.',
        QUOTA_EXCEEDED: 'La limite d\'utilisation du fournisseur LLM externe a été dépassée. Veuillez réessayer plus tard ou sélectionner un autre modèle.',
        INSUFFICIENT_CREDIT: 'Le fournisseur LLM externe dispose d\'un crédit insuffisant. Veuillez contacter l\'administrateur ou sélectionner un autre modèle.',
        MODEL_NOT_FOUND: 'Le modèle sélectionné est introuvable chez le fournisseur LLM externe. Veuillez actualiser la liste des modèles ou sélectionner un autre modèle.',
        NOT_SUPPORTED: 'Le modèle sélectionné ne prend pas en charge cette fonctionnalité. Veuillez essayer un autre modèle.',
        UPSTREAM_ERROR: 'Une erreur temporaire s\'est produite chez le fournisseur LLM externe. Veuillez réessayer plus tard.',
        INVALID_MODEL_ID: 'Le format de l\'identifiant du modèle est invalide. Veuillez resélectionner dans la liste des modèles.',
    },
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
