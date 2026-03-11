/**
 * DiscussionStrategy 단위 테스트
 *
 * 테스트 범위:
 * - 문서 컨텍스트 추출 (docId 유/무)
 * - 대화 히스토리 변환
 * - 사용자 메모리 조회 (userId 유/무, guest 처리)
 * - 이미지 분석 (이미지 없음, 있음, 최대 3개 제한)
 * - DiscussionEngine startDiscussion 호출
 * - 결과 포맷팅 및 스트리밍
 * - 토론 실패 시 fallback 응답
 * - webSearch 사실 검증 활성화/비활성화
 */
import { DiscussionStrategy } from '../domains/chat/strategies/discussion-strategy';
import type { DiscussionStrategyContext } from '../domains/chat/strategies/types';
import type { OllamaClient } from '../ollama/client';
import type { ChatMessageRequest } from '../domains/chat/service';
import type { DocumentStore } from '../domains/rag/documents/store';

// ─────────────────────────────────────────────
// Mock 설정
// ─────────────────────────────────────────────

const mockStartDiscussion = jest.fn();
const mockBuildMemoryContext = jest.fn();
const mockPerformWebSearch = jest.fn();
const mockClientChat = jest.fn();

// createDiscussionEngine mock: 팩토리를 반환하는 mock
jest.mock('../agents/discussion-engine', () => ({
    createDiscussionEngine: jest.fn().mockReturnValue({
        startDiscussion: jest.fn(),
        selectExpertAgents: jest.fn().mockResolvedValue([]),
    }),
}));

// MemoryService 동적 import mock
jest.mock('../domains/memory/MemoryService', () => ({
    getMemoryService: jest.fn().mockReturnValue({
        buildMemoryContext: mockBuildMemoryContext,
    }),
}));

// mcp 동적 import mock (performWebSearch)
jest.mock('../mcp', () => ({
    performWebSearch: mockPerformWebSearch,
}));

jest.mock('../domains/chat/pipeline/language-policy', () => ({
    resolvePromptLocale: (lang: string) => {
        const map: Record<string, string> = { ko: 'ko', en: 'en', ja: 'ja', zh: 'zh', es: 'es', de: 'de' };
        return map[lang] || 'en';
    },
}));

// ─────────────────────────────────────────────
// Mock 참조 획득
// ─────────────────────────────────────────────

import { createDiscussionEngine } from '../agents/discussion-engine';

const mockCreateDiscussionEngine = createDiscussionEngine as jest.MockedFunction<typeof createDiscussionEngine>;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const makeDiscussionResult = () => ({
    summary: '토론 요약입니다.',
    participants: [{ name: '전문가1', role: '분석가' }, { name: '전문가2', role: '검증자' }],
    totalTime: 2500,
    rounds: [],
    factChecks: [],
});

const makeReq = (overrides: Partial<ChatMessageRequest> = {}): ChatMessageRequest => ({
    message: '양자 컴퓨터에 대해 설명해줘',
    userId: 'user-123',
    history: [],
    ...overrides,
} as ChatMessageRequest);

const makeClient = (): OllamaClient => ({
    model: 'qwen3-coder-next:cloud',
    chat: mockClientChat,
} as unknown as OllamaClient);

const makeDocumentStore = (): DocumentStore => ({
    get: jest.fn().mockReturnValue(undefined),
} as unknown as DocumentStore);

const makeContext = (overrides: Partial<DiscussionStrategyContext> = {}): DiscussionStrategyContext => {
    const tokens: string[] = [];
    return {
        req: makeReq(),
        client: makeClient(),
        uploadedDocuments: makeDocumentStore(),
        onToken: (token: string) => tokens.push(token),
        onProgress: undefined,
        formatDiscussionResult: jest.fn().mockReturnValue('# 토론 결과\n\n내용'),
        ...overrides,
    };
};

// ─────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────

describe('DiscussionStrategy', () => {
    let strategy: DiscussionStrategy;

    beforeEach(() => {
        jest.clearAllMocks();

        // 기본 mock 설정
        mockStartDiscussion.mockResolvedValue(makeDiscussionResult());
        mockBuildMemoryContext.mockResolvedValue({
            contextString: '',
            memories: [],
        });
        mockClientChat.mockResolvedValue({ content: '이미지 분석 결과입니다.' });
        (mockCreateDiscussionEngine as jest.Mock).mockImplementation(() => ({
            startDiscussion: mockStartDiscussion,
            selectExpertAgents: jest.fn().mockResolvedValue([]),
        }));

        strategy = new DiscussionStrategy();
    });

    // ────────────────────────────────────────
    // 기본 실행 흐름
    // ────────────────────────────────────────
    describe('기본 실행 흐름', () => {
        test('DiscussionEngine을 생성하고 startDiscussion을 호출한다', async () => {
            const ctx = makeContext();
            await strategy.execute(ctx);

            expect(mockCreateDiscussionEngine).toHaveBeenCalledTimes(1);
            expect(mockStartDiscussion).toHaveBeenCalledTimes(1);
        });

        test('startDiscussion에 message를 전달한다', async () => {
            const ctx = makeContext();
            await strategy.execute(ctx);

            expect(mockStartDiscussion).toHaveBeenCalledWith(
                '양자 컴퓨터에 대해 설명해줘',
                expect.anything()
            );
        });

        test('포맷팅된 결과를 response로 반환한다', async () => {
            const mockFormat = jest.fn().mockReturnValue('# 최종 결과');
            const ctx = makeContext({ formatDiscussionResult: mockFormat });
            const result = await strategy.execute(ctx);

            expect(result).toEqual({ response: '# 최종 결과' });
        });

        test('포맷된 결과를 문자 단위로 onToken에 전달한다', async () => {
            const tokens: string[] = [];
            const ctx = makeContext({
                formatDiscussionResult: jest.fn().mockReturnValue('AB'),
                onToken: (t: string) => tokens.push(t),
            });
            await strategy.execute(ctx);

            expect(tokens).toEqual(['A', 'B']);
        });
    });

    // ────────────────────────────────────────
    // 문서 컨텍스트 처리
    // ────────────────────────────────────────
    describe('문서 컨텍스트 처리', () => {
        test('docId가 없으면 documentContext는 빈 문자열이다', async () => {
            const ctx = makeContext({ req: makeReq({ docId: undefined }) });
            await strategy.execute(ctx);

            const engineCall = mockCreateDiscussionEngine.mock.calls[0];
            const opts = engineCall?.[1] as Record<string, unknown>;
            expect(opts?.documentContext).toBe('');
        });

        test('docId가 있지만 문서가 없으면 documentContext는 빈 문자열이다', async () => {
            const store = { get: jest.fn().mockReturnValue(undefined) } as unknown as DocumentStore;
            const ctx = makeContext({
                req: makeReq({ docId: 'doc-001' }),
                uploadedDocuments: store,
            });
            await strategy.execute(ctx);

            const opts = mockCreateDiscussionEngine.mock.calls[0]?.[1] as Record<string, unknown>;
            expect(opts?.documentContext).toBe('');
        });

        test('docId가 있고 문서가 존재하면 documentContext에 문서 내용이 포함된다', async () => {
            const store = {
                get: jest.fn().mockReturnValue({
                    filename: 'test.txt',
                    type: 'text',
                    text: '문서 본문 내용입니다.',
                    info: null,
                }),
            } as unknown as DocumentStore;
            const ctx = makeContext({
                req: makeReq({ docId: 'doc-001' }),
                uploadedDocuments: store,
            });
            await strategy.execute(ctx);

            const opts = mockCreateDiscussionEngine.mock.calls[0]?.[1] as Record<string, unknown>;
            expect(opts?.documentContext).toContain('문서 본문 내용입니다.');
            expect(opts?.documentContext).toContain('test.txt');
        });

        test('문서 텍스트가 30000자 초과이면 중간 생략 처리를 한다', async () => {
            const longText = 'A'.repeat(40000);
            const store = {
                get: jest.fn().mockReturnValue({
                    filename: 'long.txt',
                    type: 'text',
                    text: longText,
                    info: null,
                }),
            } as unknown as DocumentStore;
            const ctx = makeContext({
                req: makeReq({ docId: 'doc-long' }),
                uploadedDocuments: store,
            });
            await strategy.execute(ctx);

            const opts = mockCreateDiscussionEngine.mock.calls[0]?.[1] as Record<string, unknown>;
            expect(opts?.documentContext).toContain('[middle omitted]');
        });
    });

    // ────────────────────────────────────────
    // 대화 히스토리 처리
    // ────────────────────────────────────────
    describe('대화 히스토리 처리', () => {
        test('history가 없으면 빈 배열로 전달된다', async () => {
            const ctx = makeContext({ req: makeReq({ history: undefined }) });
            await strategy.execute(ctx);

            const opts = mockCreateDiscussionEngine.mock.calls[0]?.[1] as Record<string, unknown>;
            expect(opts?.conversationHistory).toEqual([]);
        });

        test('history가 있으면 role/content 형태로 변환된다', async () => {
            const ctx = makeContext({
                req: makeReq({
                    history: [
                        { role: 'user' as const, content: '안녕', images: undefined } as unknown as NonNullable<ChatMessageRequest['history']>[number],
                        { role: 'assistant' as const, content: '반갑습니다', images: undefined } as unknown as NonNullable<ChatMessageRequest['history']>[number],
                    ],
                }),
            });
            await strategy.execute(ctx);

            const opts = mockCreateDiscussionEngine.mock.calls[0]?.[1] as Record<string, unknown>;
            expect(opts?.conversationHistory).toEqual([
                { role: 'user', content: '안녕' },
                { role: 'assistant', content: '반갑습니다' },
            ]);
        });
    });

    // ────────────────────────────────────────
    // 사용자 메모리 처리
    // ────────────────────────────────────────
    describe('사용자 메모리 처리', () => {
        test('userId가 "guest"이면 메모리를 조회하지 않는다', async () => {
            const ctx = makeContext({ req: makeReq({ userId: 'guest' }) });
            await strategy.execute(ctx);

            expect(mockBuildMemoryContext).not.toHaveBeenCalled();
        });

        test('userId가 없으면 메모리를 조회하지 않는다', async () => {
            const ctx = makeContext({ req: makeReq({ userId: undefined }) });
            await strategy.execute(ctx);

            expect(mockBuildMemoryContext).not.toHaveBeenCalled();
        });

        test('유효한 userId이면 메모리를 조회한다', async () => {
            mockBuildMemoryContext.mockResolvedValue({
                contextString: '사용자 기억 내용',
                memories: [{ id: '1' }],
            });
            const ctx = makeContext({ req: makeReq({ userId: 'user-456' }) });
            await strategy.execute(ctx);

            expect(mockBuildMemoryContext).toHaveBeenCalledTimes(1);
            expect(mockBuildMemoryContext).toHaveBeenCalledWith('user-456', '양자 컴퓨터에 대해 설명해줘');
        });

        test('메모리 컨텍스트가 있으면 userMemoryContext에 포함된다', async () => {
            mockBuildMemoryContext.mockResolvedValue({
                contextString: '오래된 기억 정보',
                memories: [{ id: '1' }],
            });
            const ctx = makeContext({ req: makeReq({ userId: 'user-789' }) });
            await strategy.execute(ctx);

            const opts = mockCreateDiscussionEngine.mock.calls[0]?.[1] as Record<string, unknown>;
            expect(opts?.userMemoryContext).toBe('오래된 기억 정보');
        });

        test('메모리 조회 실패 시 에러를 전파하지 않고 계속 진행한다', async () => {
            mockBuildMemoryContext.mockRejectedValue(new Error('DB 연결 실패'));
            const ctx = makeContext({ req: makeReq({ userId: 'user-err' }) });

            await expect(strategy.execute(ctx)).resolves.toBeDefined();
        });
    });

    // ────────────────────────────────────────
    // 이미지 분석 처리
    // ────────────────────────────────────────
    describe('이미지 분석 처리', () => {
        test('이미지가 없으면 client.chat을 이미지 분석에 호출하지 않는다', async () => {
            const ctx = makeContext({ req: makeReq({ images: undefined }) });
            await strategy.execute(ctx);

            expect(mockClientChat).not.toHaveBeenCalled();
        });

        test('이미지가 있으면 각 이미지마다 client.chat을 호출한다', async () => {
            const ctx = makeContext({ req: makeReq({ images: ['base64img1', 'base64img2'] }) });
            await strategy.execute(ctx);

            expect(mockClientChat).toHaveBeenCalledTimes(2);
        });

        test('이미지가 3개 초과이면 최대 3개만 분석한다', async () => {
            const ctx = makeContext({
                req: makeReq({ images: ['img1', 'img2', 'img3', 'img4', 'img5'] }),
            });
            await strategy.execute(ctx);

            expect(mockClientChat).toHaveBeenCalledTimes(3);
        });

        test('이미지 분석 실패 시 에러를 전파하지 않고 [분석 실패] 메시지를 사용한다', async () => {
            mockClientChat.mockRejectedValue(new Error('비전 모델 오류'));
            const ctx = makeContext({ req: makeReq({ images: ['img1'] }) });

            await expect(strategy.execute(ctx)).resolves.toBeDefined();
        });
    });

    // ────────────────────────────────────────
    // DiscussionEngine 옵션 전달
    // ────────────────────────────────────────
    describe('DiscussionEngine 옵션 전달', () => {
        test('maxAgents=5, enableCrossReview=true, enableDeepThinking=true로 생성한다', async () => {
            const ctx = makeContext();
            await strategy.execute(ctx);

            expect(mockCreateDiscussionEngine).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    maxAgents: 5,
                    enableCrossReview: true,
                    enableDeepThinking: true,
                }),
                undefined
            );
        });

        test('webSearchContext를 DiscussionEngine 옵션에 포함한다', async () => {
            const ctx = makeContext({
                req: makeReq({ webSearchContext: '검색 결과 텍스트' }),
            });
            await strategy.execute(ctx);

            expect(mockCreateDiscussionEngine).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({ webSearchContext: '검색 결과 텍스트' }),
                undefined
            );
        });

        test('userLanguagePreference를 userLanguage로 전달한다', async () => {
            const ctx = makeContext({
                req: makeReq({ userLanguagePreference: 'ko' }),
            });
            await strategy.execute(ctx);

            expect(mockCreateDiscussionEngine).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({ userLanguage: 'ko' }),
                undefined
            );
        });

        test('onProgress를 DiscussionEngine에 전달한다', async () => {
            const mockOnProgress = jest.fn();
            const ctx = makeContext({ onProgress: mockOnProgress });
            await strategy.execute(ctx);

            expect(mockCreateDiscussionEngine).toHaveBeenCalledWith(
                expect.any(Function),
                expect.any(Object),
                mockOnProgress
            );
        });

        test('tokenLimits를 올바르게 설정한다', async () => {
            const ctx = makeContext();
            await strategy.execute(ctx);

            expect(mockCreateDiscussionEngine).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    tokenLimits: {
                        maxTotalTokens: 10000,
                        maxDocumentTokens: 4000,
                        maxHistoryTokens: 2000,
                        maxWebSearchTokens: 2000,
                        maxMemoryTokens: 1500,
                        maxImageDescriptionTokens: 500,
                    },
                }),
                undefined
            );
        });
    });

    // ────────────────────────────────────────
    // 토론 실패 fallback
    // ────────────────────────────────────────
    describe('토론 실패 fallback', () => {
        test('startDiscussion이 throw하면 fallback 응답을 반환한다', async () => {
            mockStartDiscussion.mockRejectedValue(new Error('AI 모델 오류'));
            const ctx = makeContext();
            const result = await strategy.execute(ctx);

            expect(result.response).toContain('⚠️ An error occurred during multi-agent discussion.');
        });

        test('fallback 응답을 문자 단위로 스트리밍한다', async () => {
            mockStartDiscussion.mockRejectedValue(new Error('오류'));
            const tokens: string[] = [];
            const ctx = makeContext({
                onToken: (t: string) => tokens.push(t),
            });
            await strategy.execute(ctx);

            expect(tokens.join('')).toContain('⚠️ An error occurred during multi-agent discussion.');
        });

        test('fallback 시 formatDiscussionResult를 호출하지 않는다', async () => {
            mockStartDiscussion.mockRejectedValue(new Error('오류'));
            const mockFormat = jest.fn().mockReturnValue('포맷 결과');
            const ctx = makeContext({ formatDiscussionResult: mockFormat });
            await strategy.execute(ctx);

            expect(mockFormat).not.toHaveBeenCalled();
        });
    });

    // ────────────────────────────────────────
    // 웹 검색 사실 검증
    // ────────────────────────────────────────
    describe('웹 검색 사실 검증', () => {
        test('performWebSearch가 로드되면 startDiscussion에 webSearchFn을 전달한다', async () => {
            const ctx = makeContext();
            await strategy.execute(ctx);

            // performWebSearch가 mock으로 로드됨 → startDiscussion 두 번째 인수가 함수
            const callArgs = mockStartDiscussion.mock.calls[0];
            expect(typeof callArgs?.[1]).toBe('function');
        });
    });
});
