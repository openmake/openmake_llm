/**
 * ============================================================
 * DiscussionStrategy - 멀티 에이전트 토론 전략
 * ============================================================
 *
 * 여러 전문가 에이전트가 사용자 질문에 대해 교차 검토하고
 * 팩트체킹을 수행하여 고품질의 종합 응답을 생성합니다.
 *
 * @module services/chat-strategies/discussion-strategy
 * @description
 * - 문서, 대화 이력, 웹검색, 사용자 메모리 등 다중 컨텍스트 통합
 * - 이미지 분석 및 텍스트 추출 (비전 모델 활용)
 * - DiscussionEngine을 통한 다중 에이전트 토론 오케스트레이션
 * - 웹 검색 기반 사실 검증 (팩트체킹)
 * - 토큰 제한을 고려한 컨텍스트 우선순위 관리
 */
import { createDiscussionEngine, type DiscussionResult, type DiscussionSearchResult } from '../../agents/discussion-engine';
import type { ChatMessage } from '../../llm';
import type { ChatStrategy, ChatResult, DiscussionStrategyContext } from './types';
import { createLogger } from '../../utils/logger';
import { sanitizePromptInput } from '../../utils/input-sanitizer';
import { CONTEXT_LIMITS, DISCUSSION_TOKEN_BUDGET, MODEL_CONTEXT_DEFAULTS } from '../../config/runtime-limits';
import { LLM_TEMPERATURES } from '../../config/llm-parameters';
import { resolvePromptLocale, type PromptLocaleCode } from '../../chat/language-policy';
import { withSpan } from '../../observability/otel';

const logger = createLogger('DiscussionStrategy');

const DISCUSSION_STRATEGY_LOCALE_TEXTS: Record<PromptLocaleCode, {
    documentMiddleOmitted: string;
    documentLabel: string;
    lengthLabel: string;
    lengthUnit: string;
    imageAnalysisProgress: (count: number) => string;
    imageAnalysisSystemPrompt: string;
    imageAnalysisUserPrompt: string;
    imageFallback: (index: number) => string;
    imageFailure: (index: number) => string;
    fallbackResponse: string;
}> = {
    ko: {
        documentMiddleOmitted: '... [중간 생략] ...',
        documentLabel: '📚 문서',
        lengthLabel: '길이',
        lengthUnit: '자',
        imageAnalysisProgress: (count) => `${count}개 이미지를 분석하고 있습니다...`,
        imageAnalysisSystemPrompt: '이미지를 분석하여 핵심 내용을 200자 이내로 요약해주세요. 텍스트, 도표, 그래프가 있다면 해당 내용도 포함하세요.',
        imageAnalysisUserPrompt: '이 이미지의 주요 내용을 요약해주세요.',
        imageFallback: (index) => `[이미지 ${index}: 내용 없음]`,
        imageFailure: (index) => `[이미지 ${index}: 분석 실패]`,
        fallbackResponse: [
            '⚠️ 멀티 에이전트 토론 중 오류가 발생했습니다.',
            '',
            '**원인:** AI 모델 서버에 연결할 수 없거나 응답 생성에 실패했습니다.',
            '',
            '**해결 방법:**',
            '- 잠시 후 다시 시도해주세요.',
            '- 토론 모드를 끄고 일반 모드로 질문해보세요.',
            '- 문제가 지속되면 관리자에게 문의해주세요.',
        ].join('\n'),
    },
    en: {
        documentMiddleOmitted: '... [middle omitted] ...',
        documentLabel: '📚 Document',
        lengthLabel: 'Length',
        lengthUnit: 'chars',
        imageAnalysisProgress: (count) => `Analyzing ${count} images...`,
        imageAnalysisSystemPrompt: 'Analyze the image and summarize the key content within 200 characters. Include text, tables, and graphs if present.',
        imageAnalysisUserPrompt: 'Please summarize the main content of this image.',
        imageFallback: (index) => `[Image ${index}: no content]`,
        imageFailure: (index) => `[Image ${index}: analysis failed]`,
        fallbackResponse: [
            '⚠️ An error occurred during multi-agent discussion.',
            '',
            '**Cause:** Failed to connect to the AI model server or generate responses.',
            '',
            '**How to resolve:**',
            '- Please try again shortly.',
            '- Disable discussion mode and ask in normal mode.',
            '- If the issue persists, contact the administrator.',
        ].join('\n'),
    },
    ja: {
        documentMiddleOmitted: '... [中間省略] ...',
        documentLabel: '📚 ドキュメント',
        lengthLabel: '長さ',
        lengthUnit: '文字',
        imageAnalysisProgress: (count) => `${count}枚の画像を分析しています...`,
        imageAnalysisSystemPrompt: '画像を分析し、主要内容を200文字以内で要約してください。テキスト、表、グラフがあれば含めてください。',
        imageAnalysisUserPrompt: 'この画像の主な内容を要約してください。',
        imageFallback: (index) => `[画像 ${index}: 内容なし]`,
        imageFailure: (index) => `[画像 ${index}: 分析失敗]`,
        fallbackResponse: [
            '⚠️ マルチエージェント討論中にエラーが発生しました。',
            '',
            '**原因:** AIモデルサーバーへの接続、または応答生成に失敗しました。',
            '',
            '**対処方法:**',
            '- しばらくしてから再試行してください。',
            '- 討論モードをオフにして通常モードで質問してください。',
            '- 問題が続く場合は管理者にお問い合わせください。',
        ].join('\n'),
    },
    zh: {
        documentMiddleOmitted: '... [中间省略] ...',
        documentLabel: '📚 文档',
        lengthLabel: '长度',
        lengthUnit: '字',
        imageAnalysisProgress: (count) => `正在分析 ${count} 张图片...`,
        imageAnalysisSystemPrompt: '请分析图片，并在200字以内总结核心内容。如有文字、表格或图表，请一并包含。',
        imageAnalysisUserPrompt: '请总结这张图片的主要内容。',
        imageFallback: (index) => `[图片 ${index}: 无内容]`,
        imageFailure: (index) => `[图片 ${index}: 分析失败]`,
        fallbackResponse: [
            '⚠️ 多智能体讨论过程中发生错误。',
            '',
            '**原因：** 无法连接 AI 模型服务器或生成响应失败。',
            '',
            '**解决方法：**',
            '- 请稍后重试。',
            '- 关闭讨论模式并以普通模式提问。',
            '- 若问题持续，请联系管理员。',
        ].join('\n'),
    },
    es: {
        documentMiddleOmitted: '... [se omite parte intermedia] ...',
        documentLabel: '📚 Documento',
        lengthLabel: 'Longitud',
        lengthUnit: 'caracteres',
        imageAnalysisProgress: (count) => `Analizando ${count} imágenes...`,
        imageAnalysisSystemPrompt: 'Analiza la imagen y resume el contenido clave en un máximo de 200 caracteres. Incluye texto, tablas y gráficos si existen.',
        imageAnalysisUserPrompt: 'Por favor, resume el contenido principal de esta imagen.',
        imageFallback: (index) => `[Imagen ${index}: sin contenido]`,
        imageFailure: (index) => `[Imagen ${index}: análisis fallido]`,
        fallbackResponse: [
            '⚠️ Ocurrió un error durante la discusión multiagente.',
            '',
            '**Causa:** No se pudo conectar al servidor del modelo de IA o falló la generación de respuestas.',
            '',
            '**Cómo resolverlo:**',
            '- Inténtalo de nuevo en unos minutos.',
            '- Desactiva el modo de discusión y pregunta en modo normal.',
            '- Si el problema persiste, contacta al administrador.',
        ].join('\n'),
    },
    de: {
        documentMiddleOmitted: '... [Mittelteil ausgelassen] ...',
        documentLabel: '📚 Dokument',
        lengthLabel: 'Länge',
        lengthUnit: 'Zeichen',
        imageAnalysisProgress: (count) => `${count} Bilder werden analysiert...`,
        imageAnalysisSystemPrompt: 'Analysieren Sie das Bild und fassen Sie den Kerninhalt in höchstens 200 Zeichen zusammen. Berücksichtigen Sie Text, Tabellen und Diagramme, falls vorhanden.',
        imageAnalysisUserPrompt: 'Bitte fassen Sie den Hauptinhalt dieses Bildes zusammen.',
        imageFallback: (index) => `[Bild ${index}: kein Inhalt]`,
        imageFailure: (index) => `[Bild ${index}: Analyse fehlgeschlagen]`,
        fallbackResponse: [
            '⚠️ Während der Multi-Agenten-Diskussion ist ein Fehler aufgetreten.',
            '',
            '**Ursache:** Verbindung zum KI-Modellserver oder Antworterzeugung fehlgeschlagen.',
            '',
            '**Lösung:**',
            '- Bitte versuchen Sie es in Kürze erneut.',
            '- Deaktivieren Sie den Diskussionsmodus und fragen Sie im normalen Modus.',
            '- Wenn das Problem bestehen bleibt, wenden Sie sich an den Administrator.',
        ].join('\n'),
    },
    fr: {
        documentMiddleOmitted: '... [partie intermédiaire omise] ...',
        documentLabel: '📚 Document',
        lengthLabel: 'Longueur',
        lengthUnit: 'caractères',
        imageAnalysisProgress: (count) => `Analyse de ${count} images en cours...`,
        imageAnalysisSystemPrompt: 'Analysez l\'image et résumez le contenu clé en 200 caractères maximum. Incluez le texte, les tableaux et les graphiques s\'ils sont présents.',
        imageAnalysisUserPrompt: 'Veuillez résumer le contenu principal de cette image.',
        imageFallback: (index) => `[Image ${index} : aucun contenu]`,
        imageFailure: (index) => `[Image ${index} : échec de l\'analyse]`,
        fallbackResponse: [
            '⚠️ Une erreur est survenue lors de la discussion multi-agents.',
            '',
            '**Cause :** Échec de connexion au serveur du modèle IA ou de génération des réponses.',
            '',
            '**Solution :**',
            '- Veuillez réessayer dans quelques instants.',
            '- Désactivez le mode discussion et posez votre question en mode normal.',
            '- Si le problème persiste, contactez l\'administrateur.',
        ].join('\n'),
    },
};


/**
 * 멀티 에이전트 토론 전략
 *
 * 다중 컨텍스트(문서, 이력, 메모리, 웹검색, 이미지)를 통합한 후
 * DiscussionEngine을 통해 여러 전문가 에이전트의 토론을 관리합니다.
 *
 * @class DiscussionStrategy
 * @implements {ChatStrategy<DiscussionStrategyContext, ChatResult>}
 */
export class DiscussionStrategy implements ChatStrategy<DiscussionStrategyContext, ChatResult> {
    /**
     * 멀티 에이전트 토론을 실행합니다.
     *
     * 실행 흐름:
     * 1. 문서 컨텍스트 추출 (텍스트 + 이미지)
     * 2. 대화 히스토리 및 웹검색 컨텍스트 준비
     * 3. 사용자 장기 메모리 조회 (MemoryService)
     * 4. 이미지 분석 (최대 3개, 비전 모델 사용)
     * 5. DiscussionEngine으로 토론 수행 (교차 검토 + 팩트체킹)
     * 6. 결과 포맷팅 및 스트리밍 전송
     *
     * @param context - 토론 전략 컨텍스트 (요청, 문서, 클라이언트, 진행 콜백)
     * @returns 포맷팅된 토론 결과 응답
     */
    async execute(context: DiscussionStrategyContext): Promise<ChatResult> {
        // 토론 전체를 root span으로 감싸 5단계 비용/지연 분석을 가능하게 함.
        // 자식 span(llm.chat 등)은 AsyncLocalStorage로 자동 부모 연결됨.
        return withSpan(
            'discussion-strategy',
            'discussion.execute',
            async (rootSpan) => {
                const result = await this.executeInternal(context);
                if (typeof result.response === 'string') {
                    rootSpan.setAttribute('discussion.response_chars', result.response.length);
                }
                return result;
            },
            {
                attributes: {
                    'discussion.user_id': context.req.userId || 'guest',
                    'discussion.has_doc': !!context.req.docId,
                    'discussion.has_images': (context.req.images?.length ?? 0) > 0,
                    'discussion.history_length': context.req.history?.length ?? 0,
                    'discussion.has_web_search': !!context.req.webSearchContext,
                    'discussion.language': context.req.userLanguagePreference || 'en',
                },
            }
        );
    }

    /** 토론 실행 본체 — withSpan으로 wrap된 execute에서 호출 */
    private async executeInternal(context: DiscussionStrategyContext): Promise<ChatResult> {
        const { message, docId, history, webSearchContext, images, userId, userLanguagePreference } = context.req;
        const locale = resolvePromptLocale(userLanguagePreference || 'en');
        const localized = DISCUSSION_STRATEGY_LOCALE_TEXTS[locale];

        // 클라이언트 단절 시 즉시 토론 중단을 위한 abort 체크 헬퍼
        // checkAborted가 주어지지 않은 경우(레거시 호출자) abortSignal에서 직접 검사
        const checkAborted = context.checkAborted ?? (() => {
            if (context.abortSignal?.aborted) {
                throw new Error('ABORTED');
            }
        });

        logger.info('🎯 멀티 에이전트 토론 모드 시작');

        // 1단계: 문서 컨텍스트 추출 (텍스트 + 이미지)
        let documentContext = '';
        let documentImages: string[] = [];

        if (docId) {
            const doc = context.uploadedDocuments.get(docId);
            if (doc) {
                let docText = doc.text || '';
                const maxChars = CONTEXT_LIMITS.DEFAULT_MAX_CONTEXT_CHARS;

                if (docText.length > maxChars) {
                    const half = Math.floor(maxChars / 2);
                    docText = `${docText.substring(0, half)}\n${localized.documentMiddleOmitted}\n${docText.substring(docText.length - half)}`;
                }

                documentContext = `${localized.documentLabel}: ${doc.filename} (${doc.type})\n` +
                    `${localized.lengthLabel}: ${doc.text.length}${localized.lengthUnit}\n\n${docText}`;

                logger.info(`📄 문서 컨텍스트 적용: ${doc.filename} (${docText.length}자)`);

                if (['image', 'pdf'].includes(doc.type) && doc.info?.base64) {
                    documentImages.push(doc.info.base64);
                    logger.info('🖼️ 문서 이미지 데이터 추출됨');
                }
            }
        }

        // 2단계: 대화 히스토리 변환 (프롬프트 인젝션 방어를 위해 content 정제)
        const conversationHistory = history?.map((h) => ({
            role: h.role as string,
            content: sanitizePromptInput(h.content as string),
        })) || [];

        if (conversationHistory.length > 0) {
            logger.info(`💬 대화 히스토리 적용: ${conversationHistory.length}개 메시지`);
        }

        if (webSearchContext) {
            logger.info(`🔍 웹 검색 컨텍스트 적용: ${webSearchContext.length}자`);
        }

        // 3단계: 사용자 장기 메모리 조회 (게스트가 아닌 경우만)
        let userMemoryContext = '';
        if (userId && userId !== 'guest') {
            try {
                const { getMemoryService } = await import('../MemoryService');
                const memoryService = getMemoryService();
                const memoryResult = await memoryService.buildMemoryContext(userId, message);

                if (memoryResult.contextString) {
                    userMemoryContext = memoryResult.contextString;
                    logger.info(`💾 사용자 메모리 컨텍스트 적용: ${memoryResult.memories.length}개 기억, ${userMemoryContext.length}자`);
                }
            } catch (e) {
                logger.warn('MemoryService 로드 실패:', e);
            }
        }

        // 4단계: 이미지 분석 (최대 3개, 비전 모델을 통해 텍스트 설명 추출)
        const allImages = [...(images || []), ...documentImages];
        let imageDescriptions: string[] = [];

        if (allImages.length > 0) {
            logger.info(`🖼️ ${allImages.length}개 이미지 분석 시작...`);

            context.onProgress?.({
                phase: 'selecting',
                message: localized.imageAnalysisProgress(allImages.length),
                progress: 2,
            });

            const imagePromises = allImages.slice(0, 3).map(async (imageBase64, i) => {
                try {
                    checkAborted();
                    const analysisResponse = await context.client.chat(
                        [
                            {
                                role: 'system',
                                content: localized.imageAnalysisSystemPrompt,
                            },
                            {
                                role: 'user',
                                content: localized.imageAnalysisUserPrompt,
                                images: [imageBase64],
                            },
                        ],
                        { temperature: LLM_TEMPERATURES.DISCUSSION }
                    );

                    if (analysisResponse.content) {
                        logger.info(`✅ 이미지 ${i + 1} 분석 완료`);
                        return analysisResponse.content.substring(0, 500);
                    }

                    return localized.imageFallback(i + 1);
                } catch (e) {
                    logger.warn(`이미지 ${i + 1} 분석 실패:`, e);
                    return localized.imageFailure(i + 1);
                }
            });

            imageDescriptions = await Promise.all(imagePromises);
        }

        // 5단계: DiscussionEngine 생성 및 토론 실행
        /** DiscussionEngine에 주입할 LLM 응답 생성 함수
         *  - 호출 직전 abort 체크: 다음 라운드/전문가로 진입 전 중단
         *  - 스트리밍 토큰 콜백 내부 abort 체크: 진행 중인 LLM 호출의 다음 토큰을 throw로 차단
         *    (LLMClient.chat이 abortSignal 인자를 받지 않으므로 콜백 throw가 가장 적은 침습)
         */
        const generateResponse = async (systemPrompt: string, userMessage: string): Promise<string> => {
            checkAborted();
            let response = '';
            const chatMessages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ];

            await context.client.chat(chatMessages, { num_predict: MODEL_CONTEXT_DEFAULTS.DEFAULT_NUM_PREDICT }, (token, thinking) => {
                // Discussion 참가 모델의 thinking은 무시하고 content만 수집
                if (!thinking) {
                    response += token;
                }
                // 토큰 콜백마다 abort 체크 → 클라이언트 단절 시 다음 토큰 직전에 stream 중단
                checkAborted();
            });

            return response;
        };

        const discussionEngine = createDiscussionEngine(
            generateResponse,
            {
                maxAgents: 5,
                enableCrossReview: true,
                enableDeepThinking: true,
                userLanguage: userLanguagePreference,
                documentContext,
                conversationHistory,
                userMemoryContext,
                webSearchContext,
                imageContexts: allImages,
                imageDescriptions,
                contextPriority: {
                    userMemory: 1,
                    conversationHistory: 2,
                    document: 3,
                    webSearch: 4,
                    image: 5,
                },
                tokenLimits: {
                    maxTotalTokens: DISCUSSION_TOKEN_BUDGET.DEFAULT.maxTotalTokens,
                    maxDocumentTokens: DISCUSSION_TOKEN_BUDGET.DEFAULT.maxDocumentTokens,
                    maxHistoryTokens: DISCUSSION_TOKEN_BUDGET.DEFAULT.maxHistoryTokens,
                    maxWebSearchTokens: DISCUSSION_TOKEN_BUDGET.DEFAULT.maxWebSearchTokens,
                    maxMemoryTokens: DISCUSSION_TOKEN_BUDGET.DEFAULT.maxMemoryTokens,
                    maxImageDescriptionTokens: 500,
                },
            },
            context.onProgress
        );

        // 웹 검색 기반 사실 검증 함수 로드 (선택적)
        let webSearchFn: ((q: string, opts?: { maxResults?: number }) => Promise<DiscussionSearchResult[]>) | undefined;
        try {
            const { performWebSearch } = await import('../../mcp');
            webSearchFn = performWebSearch;
            logger.info('🔍 웹 검색 사실 검증 활성화');
        } catch (e) {
            logger.warn('웹 검색 모듈 로드 실패, 사실 검증 비활성화');
        }

        // 6단계: 토론 실행 및 결과 포맷팅/스트리밍
        checkAborted();
        let result: DiscussionResult;
        try {
            result = await discussionEngine.startDiscussion(message, webSearchFn);
        } catch (discussionError) {
            const errMsg = discussionError instanceof Error ? discussionError.message : String(discussionError);
            // ABORTED는 정상적인 클라이언트 단절 → 폴백 메시지 없이 그대로 전파
            // 이미 클라이언트는 끊겼으므로 폴백 응답을 보낼 필요가 없음
            if (errMsg === 'ABORTED') {
                logger.info('토론 중단됨 (클라이언트 단절)');
                throw discussionError;
            }
            logger.error(`❌ 토론 엔진 실행 실패: ${errMsg}`);

            const fallbackResponse = localized.fallbackResponse;

            for (const char of fallbackResponse) {
                context.onToken(char);
            }

            return { response: fallbackResponse };
        }

        const formattedResponse = context.formatDiscussionResult(result);

        // 포맷팅된 결과를 스트리밍 전송 (100자마다 abort 체크 — 매 문자 체크는 오버헤드)
        const ABORT_CHECK_INTERVAL = 100;
        for (let i = 0; i < formattedResponse.length; i++) {
            if (i % ABORT_CHECK_INTERVAL === 0) {
                checkAborted();
            }
            context.onToken(formattedResponse[i]);
        }

        logger.info(`🎯 토론 완료: ${result.totalTime}ms, 참여자: ${result.participants.length}명`);
        logger.info('📊 컨텍스트 사용 현황:');
        logger.info(`   - 문서: ${documentContext ? '✓' : '✗'} (${documentContext.length}자)`);
        logger.info(`   - 히스토리: ${conversationHistory.length}개 메시지`);
        logger.info(`   - 메모리: ${userMemoryContext ? '✓' : '✗'} (${userMemoryContext.length}자)`);
        logger.info(`   - 웹검색: ${webSearchContext ? '✓' : '✗'}`);
        logger.info(`   - 이미지: ${imageDescriptions.length}개 분석됨`);

        return { response: formattedResponse };
    }
}
