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
import { createDiscussionEngine, type DiscussionResult } from '../../agents/discussion-engine';
import type { ChatMessage } from '../../ollama/types';
import type { ChatStrategy, ChatResult, DiscussionStrategyContext } from './types';
import { createLogger } from '../../utils/logger';

const logger = createLogger('DiscussionStrategy');

/**
 * 웹 검색 결과 인터페이스 (토론 내부용)
 * @interface WebSearchResult
 */
interface WebSearchResult {
    /** 검색 결과 제목 */
    title: string;
    /** 검색 결과 URL */
    url: string;
    /** 검색 결과 요약 스니펫 */
    snippet?: string;
}

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
        const { message, docId, history, webSearchContext, images, userId } = context.req;

        logger.info('🎯 멀티 에이전트 토론 모드 시작');

        // 1단계: 문서 컨텍스트 추출 (텍스트 + 이미지)
        let documentContext = '';
        let documentImages: string[] = [];

        if (docId) {
            const doc = context.uploadedDocuments.get(docId);
            if (doc) {
                let docText = doc.text || '';
                const maxChars = 30000;

                if (docText.length > maxChars) {
                    const half = Math.floor(maxChars / 2);
                    docText = `${docText.substring(0, half)}\n... [중간 생략] ...\n${docText.substring(docText.length - half)}`;
                }

                documentContext = `📚 문서: ${doc.filename} (${doc.type})\n` +
                    `길이: ${doc.text.length}자\n\n${docText}`;

                logger.info(`📄 문서 컨텍스트 적용: ${doc.filename} (${docText.length}자)`);

                if (['image', 'pdf'].includes(doc.type) && doc.info?.base64) {
                    documentImages.push(doc.info.base64);
                    logger.info('🖼️ 문서 이미지 데이터 추출됨');
                }
            }
        }

        // 2단계: 대화 히스토리 변환
        const conversationHistory = history?.map((h) => ({
            role: h.role as string,
            content: h.content as string,
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
                message: `${allImages.length}개 이미지를 분석하고 있습니다...`,
                progress: 2,
            });

            const imagePromises = allImages.slice(0, 3).map(async (imageBase64, i) => {
                try {
                    const analysisResponse = await context.client.chat(
                        [
                            {
                                role: 'system',
                                content: '이미지를 분석하여 핵심 내용을 200자 이내로 요약해주세요. 텍스트, 도표, 그래프가 있다면 해당 내용도 포함하세요.',
                            },
                            {
                                role: 'user',
                                content: '이 이미지의 주요 내용을 요약해주세요.',
                                images: [imageBase64],
                            },
                        ],
                        { temperature: 0.2 }
                    );

                    if (analysisResponse.content) {
                        logger.info(`✅ 이미지 ${i + 1} 분석 완료`);
                        return analysisResponse.content.substring(0, 500);
                    }

                    return `[이미지 ${i + 1}: 내용 없음]`;
                } catch (e) {
                    logger.warn(`이미지 ${i + 1} 분석 실패:`, e);
                    return `[이미지 ${i + 1}: 분석 실패]`;
                }
            });

            imageDescriptions = await Promise.all(imagePromises);
        }

        // 5단계: DiscussionEngine 생성 및 토론 실행
        /** DiscussionEngine에 주입할 LLM 응답 생성 함수 */
        const generateResponse = async (systemPrompt: string, userMessage: string): Promise<string> => {
            let response = '';
            const chatMessages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ];

            await context.client.chat(chatMessages, {}, (token) => {
                response += token;
            });

            return response;
        };

        const discussionEngine = createDiscussionEngine(
            generateResponse,
            {
                maxAgents: 5,
                enableCrossReview: true,
                enableDeepThinking: true,
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
                    maxTotalTokens: 10000,
                    maxDocumentTokens: 4000,
                    maxHistoryTokens: 2000,
                    maxWebSearchTokens: 2000,
                    maxMemoryTokens: 1500,
                    maxImageDescriptionTokens: 500,
                },
            },
            context.onProgress
        );

        // 웹 검색 기반 사실 검증 함수 로드 (선택적)
        let webSearchFn: ((q: string, opts?: { maxResults?: number }) => Promise<WebSearchResult[]>) | undefined;
        try {
            const { performWebSearch } = await import('../../mcp');
            webSearchFn = performWebSearch;
            logger.info('🔍 웹 검색 사실 검증 활성화');
        } catch (e) {
            logger.warn('웹 검색 모듈 로드 실패, 사실 검증 비활성화');
        }

        // 6단계: 토론 실행 및 결과 포맷팅/스트리밍
        let result: DiscussionResult;
        try {
            result = await discussionEngine.startDiscussion(message, webSearchFn);
        } catch (discussionError) {
            const errMsg = discussionError instanceof Error ? discussionError.message : String(discussionError);
            logger.error(`❌ 토론 엔진 실행 실패: ${errMsg}`);

            const fallbackResponse = '⚠️ 멀티 에이전트 토론 중 오류가 발생했습니다.\n\n' +
                '**원인:** AI 모델 서버에 연결할 수 없거나 응답 생성에 실패했습니다.\n\n' +
                '**해결 방법:**\n' +
                '- 잠시 후 다시 시도해주세요.\n' +
                '- 토론 모드를 끄고 일반 모드로 질문해보세요.\n' +
                '- 문제가 지속되면 관리자에게 문의해주세요.';

            for (const char of fallbackResponse) {
                context.onToken(char);
            }

            return { response: fallbackResponse };
        }

        const formattedResponse = context.formatDiscussionResult(result);

        // 포맷팅된 결과를 문자 단위로 스트리밍 전송
        for (const char of formattedResponse) {
            context.onToken(char);
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
