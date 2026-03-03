/**
 * DeepResearchStrategy 단위 테스트
 *
 * 테스트 범위:
 * - DeepResearchService 생성 파라미터 검증
 * - UUID 세션 ID 생성 및 DB 저장
 * - executeResearch 호출 및 결과 포맷팅
 * - 문자 단위 스트리밍 (onToken 콜백)
 * - userId 조건부 처리 (guest / anon- / 유효 userId)
 * - onProgress 콜백 전달
 * - 에러 전파
 */
import { DeepResearchStrategy } from '../services/chat-strategies/deep-research-strategy';
import type { DeepResearchStrategyContext } from '../services/chat-strategies/types';
import type { OllamaClient } from '../ollama/client';
import type { ChatMessageRequest } from '../services/ChatService';

// ─────────────────────────────────────────────
// Mock 설정 (jest.mock은 호이스팅되므로 팩토리 내부에서 jest.fn() 생성)
// ─────────────────────────────────────────────

jest.mock('../services/DeepResearchService', () => ({
    DeepResearchService: jest.fn().mockImplementation(() => ({
        executeResearch: jest.fn(),
    })),
}));

jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: jest.fn().mockReturnValue({
        createResearchSession: jest.fn(),
    }),
}));

jest.mock('uuid', () => ({
    v4: jest.fn().mockReturnValue('test-uuid-1234'),
}));

// ─────────────────────────────────────────────
// Mock 참조 획득 (import 후 jest.mocked 사용)
// ─────────────────────────────────────────────

import { DeepResearchService } from '../services/DeepResearchService';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { v4 as uuidv4 } from 'uuid';

const MockDeepResearchService = DeepResearchService as unknown as jest.Mock;
const mockGetUnifiedDatabase = getUnifiedDatabase as jest.MockedFunction<typeof getUnifiedDatabase>;
const mockUuidV4 = uuidv4 as jest.MockedFunction<typeof uuidv4>;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const makeResearchResult = (overrides: Partial<{
    topic: string;
    summary: string;
    keyFindings: string[];
    sources: Array<{ title: string; url: string }>;
    totalSteps: number;
    duration: number;
}> = {}) => ({
    topic: 'AI 트렌드',
    summary: '인공지능은 빠르게 발전하고 있습니다.',
    keyFindings: ['LLM 발전', '멀티모달 급성장'],
    sources: [{ title: 'AI Weekly', url: 'https://example.com' }],
    totalSteps: 5,
    duration: 3000,
    ...overrides,
});

const makeReq = (overrides: Partial<ChatMessageRequest> = {}): ChatMessageRequest => ({
    message: 'AI 트렌드 연구해줘',
    userId: 'user-123',
    ...overrides,
} as ChatMessageRequest);

const makeClient = (): OllamaClient => ({
    model: 'qwen3-coder-next:cloud',
} as unknown as OllamaClient);

const makeContext = (overrides: Partial<DeepResearchStrategyContext> = {}): DeepResearchStrategyContext => {
    const tokens: string[] = [];
    return {
        req: makeReq(),
        client: makeClient(),
        onToken: (token: string) => tokens.push(token),
        onProgress: undefined,
        formatResearchResult: jest.fn().mockReturnValue('# 연구 결과\n\n내용'),
        ...overrides,
    };
};

// ─────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────

describe('DeepResearchStrategy', () => {
    let strategy: DeepResearchStrategy;
    let mockExecuteResearch: jest.Mock;
    let mockCreateResearchSession: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();

        // 매 테스트마다 새 mock 인스턴스를 반환하도록 설정
        mockExecuteResearch = jest.fn().mockResolvedValue(makeResearchResult());
        mockCreateResearchSession = jest.fn().mockResolvedValue(undefined);

        MockDeepResearchService.mockImplementation(() => ({
            executeResearch: mockExecuteResearch,
        }) as unknown as InstanceType<typeof DeepResearchService>);

        mockGetUnifiedDatabase.mockReturnValue({
            createResearchSession: mockCreateResearchSession,
        } as unknown as ReturnType<typeof getUnifiedDatabase>);

        mockUuidV4.mockReturnValue('test-uuid-1234' as unknown as ReturnType<typeof uuidv4>);

        strategy = new DeepResearchStrategy();
    });

    // ────────────────────────────────────────
    // DeepResearchService 생성 파라미터
    // ────────────────────────────────────────
    describe('DeepResearchService 생성 파라미터', () => {
        test('DeepResearchService를 올바른 파라미터로 생성한다', async () => {
            const ctx = makeContext();
            await strategy.execute(ctx);

            expect(MockDeepResearchService).toHaveBeenCalledTimes(1);
            expect(MockDeepResearchService).toHaveBeenCalledWith({
                maxLoops: 5,
                llmModel: 'qwen3-coder-next:cloud',
                searchApi: 'all',
                maxSearchResults: 360,
                language: 'ko',
                maxTotalSources: 80,
                scrapeFullContent: true,
                maxScrapePerLoop: 15,
                scrapeTimeoutMs: 15000,
                chunkSize: 10,
            });
        });

        test('client.model을 llmModel로 전달한다', async () => {
            const ctx = makeContext({ client: { model: 'gemini-3-flash-preview:cloud' } as unknown as OllamaClient });
            await strategy.execute(ctx);

            expect(MockDeepResearchService).toHaveBeenCalledWith(
                expect.objectContaining({ llmModel: 'gemini-3-flash-preview:cloud' })
            );
        });
    });

    // ────────────────────────────────────────
    // UUID 세션 ID 생성 및 DB 저장
    // ────────────────────────────────────────
    describe('UUID 세션 ID 생성 및 DB 저장', () => {
        test('uuidv4로 세션 ID를 생성한다', async () => {
            const ctx = makeContext();
            await strategy.execute(ctx);

            expect(mockUuidV4).toHaveBeenCalledTimes(1);
        });

        test('createResearchSession을 생성된 UUID와 함께 호출한다', async () => {
            const ctx = makeContext();
            await strategy.execute(ctx);

            expect(mockCreateResearchSession).toHaveBeenCalledTimes(1);
            expect(mockCreateResearchSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'test-uuid-1234',
                    topic: 'AI 트렌드 연구해줘',
                    depth: 'deep',
                })
            );
        });

        test('유효한 userId는 DB에 저장한다', async () => {
            const ctx = makeContext({ req: makeReq({ userId: 'user-456' }) });
            await strategy.execute(ctx);

            expect(mockCreateResearchSession).toHaveBeenCalledWith(
                expect.objectContaining({ userId: 'user-456' })
            );
        });

        test('userId가 "guest"이면 undefined로 저장한다', async () => {
            const ctx = makeContext({ req: makeReq({ userId: 'guest' }) });
            await strategy.execute(ctx);

            expect(mockCreateResearchSession).toHaveBeenCalledWith(
                expect.objectContaining({ userId: undefined })
            );
        });

        test('userId가 "anon-" 접두사이면 undefined로 저장한다', async () => {
            const ctx = makeContext({ req: makeReq({ userId: 'anon-abc123' }) });
            await strategy.execute(ctx);

            expect(mockCreateResearchSession).toHaveBeenCalledWith(
                expect.objectContaining({ userId: undefined })
            );
        });

        test('userId가 undefined이면 undefined로 저장한다', async () => {
            const ctx = makeContext({ req: makeReq({ userId: undefined }) });
            await strategy.execute(ctx);

            expect(mockCreateResearchSession).toHaveBeenCalledWith(
                expect.objectContaining({ userId: undefined })
            );
        });
    });

    // ────────────────────────────────────────
    // executeResearch 호출
    // ────────────────────────────────────────
    describe('executeResearch 호출', () => {
        test('executeResearch를 sessionId, message, onProgress로 호출한다', async () => {
            const mockOnProgress = jest.fn();
            const ctx = makeContext({ onProgress: mockOnProgress });
            await strategy.execute(ctx);

            expect(mockExecuteResearch).toHaveBeenCalledTimes(1);
            expect(mockExecuteResearch).toHaveBeenCalledWith(
                'test-uuid-1234',
                'AI 트렌드 연구해줘',
                mockOnProgress
            );
        });

        test('onProgress가 없으면 undefined를 전달한다', async () => {
            const ctx = makeContext({ onProgress: undefined });
            await strategy.execute(ctx);

            expect(mockExecuteResearch).toHaveBeenCalledWith(
                'test-uuid-1234',
                'AI 트렌드 연구해줘',
                undefined
            );
        });
    });

    // ────────────────────────────────────────
    // 결과 포맷팅 및 스트리밍
    // ────────────────────────────────────────
    describe('결과 포맷팅 및 스트리밍', () => {
        test('formatResearchResult를 executeResearch 결과로 호출한다', async () => {
            const researchResult = makeResearchResult({ summary: '고유 요약입니다' });
            mockExecuteResearch.mockResolvedValue(researchResult);
            const mockFormat = jest.fn().mockReturnValue('포맷된 결과');
            const ctx = makeContext({ formatResearchResult: mockFormat });
            await strategy.execute(ctx);

            expect(mockFormat).toHaveBeenCalledTimes(1);
            expect(mockFormat).toHaveBeenCalledWith(researchResult);
        });

        test('포맷된 결과를 문자 단위로 onToken에 전달한다', async () => {
            const mockFormat = jest.fn().mockReturnValue('ABC');
            const tokens: string[] = [];
            const ctx = makeContext({
                formatResearchResult: mockFormat,
                onToken: (t: string) => tokens.push(t),
            });
            await strategy.execute(ctx);

            expect(tokens).toEqual(['A', 'B', 'C']);
        });

        test('포맷된 결과의 모든 문자가 순서대로 전달된다', async () => {
            const formatted = '안녕하세요!';
            const mockFormat = jest.fn().mockReturnValue(formatted);
            const tokens: string[] = [];
            const ctx = makeContext({
                formatResearchResult: mockFormat,
                onToken: (t: string) => tokens.push(t),
            });
            await strategy.execute(ctx);

            expect(tokens).toEqual([...formatted]);
            expect(tokens.join('')).toBe(formatted);
        });

        test('빈 포맷 결과이면 onToken을 호출하지 않는다', async () => {
            const mockFormat = jest.fn().mockReturnValue('');
            const mockOnToken = jest.fn();
            const ctx = makeContext({
                formatResearchResult: mockFormat,
                onToken: mockOnToken,
            });
            await strategy.execute(ctx);

            expect(mockOnToken).not.toHaveBeenCalled();
        });
    });

    // ────────────────────────────────────────
    // 반환값
    // ────────────────────────────────────────
    describe('반환값', () => {
        test('포맷된 연구 결과를 response로 반환한다', async () => {
            const mockFormat = jest.fn().mockReturnValue('# 최종 보고서\n\n내용');
            const ctx = makeContext({ formatResearchResult: mockFormat });
            const result = await strategy.execute(ctx);

            expect(result).toEqual({ response: '# 최종 보고서\n\n내용' });
        });

        test('빈 포맷 결과이면 빈 문자열 response를 반환한다', async () => {
            const mockFormat = jest.fn().mockReturnValue('');
            const ctx = makeContext({ formatResearchResult: mockFormat });
            const result = await strategy.execute(ctx);

            expect(result).toEqual({ response: '' });
        });
    });

    // ────────────────────────────────────────
    // 에러 전파
    // ────────────────────────────────────────
    describe('에러 전파', () => {
        test('executeResearch가 throw하면 에러를 전파한다', async () => {
            const error = new Error('연구 서비스 오류');
            mockExecuteResearch.mockRejectedValue(error);
            const ctx = makeContext();

            await expect(strategy.execute(ctx)).rejects.toThrow('연구 서비스 오류');
        });

        test('createResearchSession이 throw하면 에러를 전파한다', async () => {
            mockCreateResearchSession.mockRejectedValue(new Error('DB 저장 실패'));
            const ctx = makeContext();

            await expect(strategy.execute(ctx)).rejects.toThrow('DB 저장 실패');
        });

        test('DB 저장 실패 시 executeResearch를 호출하지 않는다', async () => {
            mockCreateResearchSession.mockRejectedValue(new Error('DB 연결 오류'));
            const ctx = makeContext();

            try { await strategy.execute(ctx); } catch { /* 에러 흡수 */ }

            expect(mockExecuteResearch).not.toHaveBeenCalled();
        });
    });

    // ────────────────────────────────────────
    // 실행 순서
    // ────────────────────────────────────────
    describe('실행 순서', () => {
        test('DB 저장 → executeResearch → 포맷팅 → 스트리밍 순서로 실행된다', async () => {
            const callOrder: string[] = [];

            mockCreateResearchSession.mockImplementation(async () => {
                callOrder.push('db');
            });
            mockExecuteResearch.mockImplementation(async () => {
                callOrder.push('research');
                return makeResearchResult();
            });
            const mockFormat = jest.fn().mockImplementation(() => {
                callOrder.push('format');
                return 'X';
            });
            const ctx = makeContext({
                formatResearchResult: mockFormat,
                onToken: (t: string) => {
                    callOrder.push(`token:${t}`);
                },
            });

            await strategy.execute(ctx);

            expect(callOrder[0]).toBe('db');
            expect(callOrder[1]).toBe('research');
            expect(callOrder[2]).toBe('format');
            expect(callOrder[3]).toBe('token:X');
        });
    });
});
