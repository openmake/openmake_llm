/**
 * ============================================================
 * A2AStrategy Unit Tests
 * ============================================================
 *
 * Agent-to-Agent 병렬 생성 전략(A2AStrategy)에 대한 단위 테스트입니다.
 *
 * 검증 항목:
 * - 양쪽 모두 성공 → Synthesizer가 두 응답을 종합하여 반환 (succeeded=true)
 * - Primary만 성공, Secondary 실패 → 단독 응답 반환 (succeeded=true)
 * - Secondary만 성공, Primary 실패 → 단독 응답 반환 (succeeded=true)
 * - 양쪽 모두 실패 → succeeded=false, response=''
 * - abortSignal 취소 시 'ABORTED' 에러 throw
 * - onToken 콜백을 통한 스트리밍 검증
 */

// ============================================
// Mock Setup (MUST be before imports)
// ============================================

/** 각 OllamaClient 인스턴스별 chat mock — 인스턴스 순서로 호출 순서 추적 */
const mockChatA = jest.fn();  // clientA (primary)
const mockChatB = jest.fn();  // clientB (secondary)
const mockChatS = jest.fn();  // synthesizerClient

/** 생성 순서대로 mock chat 함수를 할당 */
let _clientCreationCount = 0;
const mockOllamaClientConstructor = jest.fn().mockImplementation(() => {
    _clientCreationCount++;
    const count = _clientCreationCount;
    return {
        chat: count === 1 ? mockChatA : count === 2 ? mockChatB : mockChatS,
    };
});

jest.mock('../ollama/client', () => ({
    OllamaClient: mockOllamaClientConstructor,
}));

jest.mock('../config/env', () => ({
    getConfig: () => ({
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaDefaultModel: 'test-model',
        ollamaTimeout: 120000,
        jwtSecret: 'test-secret',
        nodeEnv: 'test',
        omkEngineLlm: 'llm-model',
        omkEnginePro: 'pro-model',
        omkEngineFast: 'fast-model',
        omkEngineCode: 'code-model',
        omkEngineVision: 'vision-model',
    }),
}));

jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

jest.mock('../chat/routing-logger', () => ({
    logA2AModelSelection: jest.fn(),
}));

// ============================================
// Imports (after mocks)
// ============================================

import { A2AStrategy } from '../services/chat-strategies/a2a-strategy';
import type { A2AStrategyContext } from '../services/chat-strategies/types';
import type { ChatMessage, ModelOptions } from '../ollama/types';

// ============================================
// Helpers
// ============================================

function makeContext(overrides: Partial<A2AStrategyContext> = {}): A2AStrategyContext {
    return {
        messages: [{ role: 'user', content: 'What is TypeScript?' }],
        chatOptions: {} as ModelOptions,
        onToken: jest.fn(),
        queryType: undefined,
        ...overrides,
    };
}

/** 단순 chat 응답 생성 */
function makeResponse(content: string) {
    return { content, tool_calls: undefined };
}

// ============================================
// Tests
// ============================================

describe('A2AStrategy', () => {
    let strategy: A2AStrategy;

    beforeEach(() => {
        strategy = new A2AStrategy();
        _clientCreationCount = 0;
        mockChatA.mockReset();
        mockChatB.mockReset();
        mockChatS.mockReset();
        mockOllamaClientConstructor.mockClear();
    });

    // ------------------------------------------
    // 양쪽 모두 성공 → 합성 경로
    // ------------------------------------------

    describe('양쪽 모두 성공 (합성 경로)', () => {
        it('succeeded=true를 반환한다', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('Response A'));
            mockChatB.mockResolvedValueOnce(makeResponse('Response B'));
            mockChatS.mockImplementationOnce(async (_msgs: ChatMessage[], _opts: ModelOptions, onToken: (t: string) => void) => {
                onToken('Synthesized response');
                return makeResponse('Synthesized response');
            });

            const ctx = makeContext();
            const result = await strategy.execute(ctx);

            expect(result.succeeded).toBe(true);
        });

        it('response에 A2A 헤더와 합성 텍스트가 포함된다', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('Answer from A'));
            mockChatB.mockResolvedValueOnce(makeResponse('Answer from B'));
            mockChatS.mockImplementationOnce(async (_msgs: ChatMessage[], _opts: ModelOptions, onToken: (t: string) => void) => {
                onToken('Final synthesized answer');
                return makeResponse('Final synthesized answer');
            });

            const result = await strategy.execute(makeContext());

            expect(result.response).toContain('A2A 종합 답변');
            expect(result.response).toContain('Final synthesized answer');
        });

        it('onToken 콜백으로 헤더와 합성 토큰이 스트리밍된다', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('A'));
            mockChatB.mockResolvedValueOnce(makeResponse('B'));
            mockChatS.mockImplementationOnce(async (_msgs: ChatMessage[], _opts: ModelOptions, onToken: (t: string) => void) => {
                onToken('token1');
                onToken('token2');
                return makeResponse('token1token2');
            });

            const onToken = jest.fn();
            const ctx = makeContext({ onToken });
            await strategy.execute(ctx);

            // 헤더 문자들 + 합성 토큰들이 모두 전달되어야 함
            const calls = onToken.mock.calls.map((c) => c[0]);
            const combined = calls.join('');
            expect(combined).toContain('token1');
            expect(combined).toContain('token2');
            expect(onToken).toHaveBeenCalled();
        });

        it('Synthesizer에 두 응답을 모두 포함하는 메시지를 전달한다', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('ResponseFromA'));
            mockChatB.mockResolvedValueOnce(makeResponse('ResponseFromB'));
            mockChatS.mockImplementationOnce(async (msgs: ChatMessage[], _opts: ModelOptions, onToken: (t: string) => void) => {
                onToken('Done');
                return makeResponse('Done');
            });

            await strategy.execute(makeContext());

            // synthesizerClient.chat()의 첫 번째 인수(messages) 확인
            const synthMsgs: ChatMessage[] = mockChatS.mock.calls[0][0];
            const userMsg = synthMsgs.find((m) => m.role === 'user');
            expect(userMsg?.content).toContain('ResponseFromA');
            expect(userMsg?.content).toContain('ResponseFromB');
        });

        it('Synthesizer 메시지에 원본 질문이 포함된다', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('A'));
            mockChatB.mockResolvedValueOnce(makeResponse('B'));
            mockChatS.mockImplementationOnce(async (msgs: ChatMessage[], _opts: ModelOptions, onToken: (t: string) => void) => {
                onToken('Synth');
                return makeResponse('Synth');
            });

            const ctx = makeContext({
                messages: [{ role: 'user', content: 'What is the meaning of life?' }],
            });
            await strategy.execute(ctx);

            const synthMsgs: ChatMessage[] = mockChatS.mock.calls[0][0];
            const userMsg = synthMsgs.find((m) => m.role === 'user');
            expect(userMsg?.content).toContain('What is the meaning of life?');
        });

        it('총 3개의 OllamaClient를 생성한다 (primary, secondary, synthesizer)', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('A'));
            mockChatB.mockResolvedValueOnce(makeResponse('B'));
            mockChatS.mockImplementationOnce(async (_msgs: ChatMessage[], _opts: ModelOptions, onToken: (t: string) => void) => {
                onToken('S');
                return makeResponse('S');
            });

            await strategy.execute(makeContext());

            expect(mockOllamaClientConstructor).toHaveBeenCalledTimes(3);
        });
    });

    // ------------------------------------------
    // Primary만 성공, Secondary 실패
    // ------------------------------------------

    describe('Primary만 성공, Secondary 실패', () => {
        it('succeeded=true를 반환한다', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('Primary response'));
            mockChatB.mockRejectedValueOnce(new Error('Secondary failed'));

            const ctx = makeContext();
            const result = await strategy.execute(ctx);

            expect(result.succeeded).toBe(true);
        });

        it('response에 Primary 응답이 포함된다', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('Primary response content'));
            mockChatB.mockRejectedValueOnce(new Error('fail'));

            const result = await strategy.execute(makeContext());

            expect(result.response).toContain('Primary response content');
        });

        it('response에 단독 응답 헤더가 포함된다', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('Primary'));
            mockChatB.mockRejectedValueOnce(new Error('fail'));

            const result = await strategy.execute(makeContext());

            expect(result.response).toContain('단독 응답');
        });

        it('onToken으로 헤더와 응답이 스트리밍된다', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('Primary answer'));
            mockChatB.mockRejectedValueOnce(new Error('fail'));

            const onToken = jest.fn();
            await strategy.execute(makeContext({ onToken }));

            const combined = onToken.mock.calls.map((c: string[]) => c[0]).join('');
            expect(combined).toContain('Primary answer');
            expect(onToken).toHaveBeenCalled();
        });

        it('Synthesizer를 호출하지 않는다 (2개의 OllamaClient만 생성)', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('Primary'));
            mockChatB.mockRejectedValueOnce(new Error('fail'));

            await strategy.execute(makeContext());

            expect(mockOllamaClientConstructor).toHaveBeenCalledTimes(2);
            expect(mockChatS).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------
    // Secondary만 성공, Primary 실패
    // ------------------------------------------

    describe('Secondary만 성공, Primary 실패', () => {
        it('succeeded=true를 반환한다', async () => {
            mockChatA.mockRejectedValueOnce(new Error('Primary failed'));
            mockChatB.mockResolvedValueOnce(makeResponse('Secondary response'));

            const result = await strategy.execute(makeContext());

            expect(result.succeeded).toBe(true);
        });

        it('response에 Secondary 응답이 포함된다', async () => {
            mockChatA.mockRejectedValueOnce(new Error('fail'));
            mockChatB.mockResolvedValueOnce(makeResponse('Secondary response content'));

            const result = await strategy.execute(makeContext());

            expect(result.response).toContain('Secondary response content');
        });

        it('Synthesizer를 호출하지 않는다', async () => {
            mockChatA.mockRejectedValueOnce(new Error('fail'));
            mockChatB.mockResolvedValueOnce(makeResponse('Secondary'));

            await strategy.execute(makeContext());

            expect(mockChatS).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------
    // 양쪽 모두 실패
    // ------------------------------------------

    describe('양쪽 모두 실패', () => {
        it('succeeded=false를 반환한다', async () => {
            mockChatA.mockRejectedValueOnce(new Error('A failed'));
            mockChatB.mockRejectedValueOnce(new Error('B failed'));

            const result = await strategy.execute(makeContext());

            expect(result.succeeded).toBe(false);
        });

        it('response가 빈 문자열이다', async () => {
            mockChatA.mockRejectedValueOnce(new Error('A failed'));
            mockChatB.mockRejectedValueOnce(new Error('B failed'));

            const result = await strategy.execute(makeContext());

            expect(result.response).toBe('');
        });

        it('onToken을 호출하지 않는다', async () => {
            mockChatA.mockRejectedValueOnce(new Error('A failed'));
            mockChatB.mockRejectedValueOnce(new Error('B failed'));

            const onToken = jest.fn();
            await strategy.execute(makeContext({ onToken }));

            expect(onToken).not.toHaveBeenCalled();
        });

        it('Synthesizer를 호출하지 않는다', async () => {
            mockChatA.mockRejectedValueOnce(new Error('A failed'));
            mockChatB.mockRejectedValueOnce(new Error('B failed'));

            await strategy.execute(makeContext());

            expect(mockChatS).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------
    // abortSignal
    // ------------------------------------------

    describe('abortSignal 처리', () => {
        it('병렬 요청 완료 후 abortSignal이 이미 취소된 경우 ABORTED 에러를 throw한다', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('A'));
            mockChatB.mockResolvedValueOnce(makeResponse('B'));

            const controller = new AbortController();
            controller.abort(); // 이미 취소 상태

            const ctx = makeContext({ abortSignal: controller.signal });
            await expect(strategy.execute(ctx)).rejects.toThrow('ABORTED');
        });

        it('abortSignal이 없으면 정상적으로 진행된다', async () => {
            mockChatA.mockResolvedValueOnce(makeResponse('A'));
            mockChatB.mockResolvedValueOnce(makeResponse('B'));
            mockChatS.mockImplementationOnce(async (_msgs: ChatMessage[], _opts: ModelOptions, onToken: (t: string) => void) => {
                onToken('Synth');
                return makeResponse('Synth');
            });

            const ctx = makeContext({ abortSignal: undefined });
            const result = await strategy.execute(ctx);

            expect(result.succeeded).toBe(true);
        });
    });

    // ------------------------------------------
    // queryType별 모델 선택
    // ------------------------------------------

    describe('queryType별 모델 선택', () => {
        async function runWithQueryType(queryType: string | undefined) {
            mockChatA.mockResolvedValueOnce(makeResponse('A'));
            mockChatB.mockResolvedValueOnce(makeResponse('B'));
            mockChatS.mockImplementationOnce(async (_msgs: ChatMessage[], _opts: ModelOptions, onToken: (t: string) => void) => {
                onToken('S');
                return makeResponse('S');
            });
            const ctx = makeContext({ queryType });
            await strategy.execute(ctx);
            return {
                primaryModel: mockOllamaClientConstructor.mock.calls[0]?.[0]?.model as string,
                secondaryModel: mockOllamaClientConstructor.mock.calls[1]?.[0]?.model as string,
                synthesizerModel: mockOllamaClientConstructor.mock.calls[2]?.[0]?.model as string,
            };
        }

        it('queryType=undefined이면 기본 모델 조합을 사용한다', async () => {
            const { primaryModel, secondaryModel } = await runWithQueryType(undefined);
            // 기본값: primary=llm-model, secondary=fast-model (getDefaultA2AModels)
            expect(primaryModel).toBe('llm-model');
            expect(secondaryModel).toBe('fast-model');
        });

        it('queryType=code이면 code-model과 llm-model을 사용한다', async () => {
            const { primaryModel, secondaryModel } = await runWithQueryType('code');
            expect(primaryModel).toBe('code-model');
            expect(secondaryModel).toBe('llm-model');
        });

        it('queryType=vision이면 vision-model과 llm-model을 사용한다', async () => {
            const { primaryModel, secondaryModel } = await runWithQueryType('vision');
            expect(primaryModel).toBe('vision-model');
            expect(secondaryModel).toBe('llm-model');
        });

        it('알 수 없는 queryType은 기본 모델 조합으로 폴백된다', async () => {
            const { primaryModel, secondaryModel } = await runWithQueryType('unknown_type');
            expect(primaryModel).toBe('llm-model');
            expect(secondaryModel).toBe('fast-model');
        });
    });
});
