import { createDiscussionEngine, type DiscussionResult } from '../../agents/discussion-engine';
import type { ChatMessage } from '../../ollama/types';
import type { ChatStrategy, ChatResult, DiscussionStrategyContext } from './types';

interface WebSearchResult {
    title: string;
    url: string;
    snippet?: string;
}

export class DiscussionStrategy implements ChatStrategy<DiscussionStrategyContext, ChatResult> {
    async execute(context: DiscussionStrategyContext): Promise<ChatResult> {
        const { message, docId, history, webSearchContext, images, userId } = context.req;

        console.log('[ChatService] 🎯 멀티 에이전트 토론 모드 시작');

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

                console.log(`[ChatService] 📄 문서 컨텍스트 적용: ${doc.filename} (${docText.length}자)`);

                if (['image', 'pdf'].includes(doc.type) && doc.info?.base64) {
                    documentImages.push(doc.info.base64);
                    console.log('[ChatService] 🖼️ 문서 이미지 데이터 추출됨');
                }
            }
        }

        const conversationHistory = history?.map((h) => ({
            role: h.role as string,
            content: h.content as string,
        })) || [];

        if (conversationHistory.length > 0) {
            console.log(`[ChatService] 💬 대화 히스토리 적용: ${conversationHistory.length}개 메시지`);
        }

        if (webSearchContext) {
            console.log(`[ChatService] 🔍 웹 검색 컨텍스트 적용: ${webSearchContext.length}자`);
        }

        let userMemoryContext = '';
        if (userId && userId !== 'guest') {
            try {
                const { getMemoryService } = await import('../MemoryService');
                const memoryService = getMemoryService();
                const memoryResult = await memoryService.buildMemoryContext(userId, message);

                if (memoryResult.contextString) {
                    userMemoryContext = memoryResult.contextString;
                    console.log(`[ChatService] 💾 사용자 메모리 컨텍스트 적용: ${memoryResult.memories.length}개 기억, ${userMemoryContext.length}자`);
                }
            } catch (e) {
                console.warn('[ChatService] MemoryService 로드 실패:', e);
            }
        }

        const allImages = [...(images || []), ...documentImages];
        let imageDescriptions: string[] = [];

        if (allImages.length > 0) {
            console.log(`[ChatService] 🖼️ ${allImages.length}개 이미지 분석 시작...`);

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
                        console.log(`[ChatService] ✅ 이미지 ${i + 1} 분석 완료`);
                        return analysisResponse.content.substring(0, 500);
                    }

                    return `[이미지 ${i + 1}: 내용 없음]`;
                } catch (e) {
                    console.warn(`[ChatService] 이미지 ${i + 1} 분석 실패:`, e);
                    return `[이미지 ${i + 1}: 분석 실패]`;
                }
            });

            imageDescriptions = await Promise.all(imagePromises);
        }

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

        let webSearchFn: ((q: string, opts?: { maxResults?: number }) => Promise<WebSearchResult[]>) | undefined;
        try {
            const { performWebSearch } = await import('../../mcp');
            webSearchFn = performWebSearch;
            console.log('[ChatService] 🔍 웹 검색 사실 검증 활성화');
        } catch (e) {
            console.warn('[ChatService] 웹 검색 모듈 로드 실패, 사실 검증 비활성화');
        }

        const result: DiscussionResult = await discussionEngine.startDiscussion(message, webSearchFn);
        const formattedResponse = context.formatDiscussionResult(result);

        for (const char of formattedResponse) {
            context.onToken(char);
        }

        console.log(`[ChatService] 🎯 토론 완료: ${result.totalTime}ms, 참여자: ${result.participants.length}명`);
        console.log('[ChatService] 📊 컨텍스트 사용 현황:');
        console.log(`   - 문서: ${documentContext ? '✓' : '✗'} (${documentContext.length}자)`);
        console.log(`   - 히스토리: ${conversationHistory.length}개 메시지`);
        console.log(`   - 메모리: ${userMemoryContext ? '✓' : '✗'} (${userMemoryContext.length}자)`);
        console.log(`   - 웹검색: ${webSearchContext ? '✓' : '✗'}`);
        console.log(`   - 이미지: ${imageDescriptions.length}개 분석됨`);

        return { response: formattedResponse };
    }
}
