/**
 * ============================================================
 * RealResponseGenerator — eval:response --real 단위 테스트
 * ============================================================
 *
 * ChatService 통합 본체는 mocking 합니다 (실제 LLM 호출 회피).
 * 검증 대상:
 *   1) timeoutMs 도달 시 EvalGuardError('timeout') throw
 *   2) onToken 누적 추정 토큰이 maxTokensPerCase 초과 시 EvalGuardError('token-budget') throw
 *   3) 정상 응답은 그대로 string 반환
 */

jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

// LLMClient 생성 자체를 막기 위해 mock — 환경변수/네트워크 의존 회피
jest.mock('../llm', () => ({
    LLMClient: jest.fn().mockImplementation(() => ({})),
}));

// ChatService 본체는 mock — processMessage만 케이스별로 다르게 동작시킴
const mockProcessMessage = jest.fn();
jest.mock('../services/ChatService', () => ({
    ChatService: jest.fn().mockImplementation(() => ({
        processMessage: mockProcessMessage,
    })),
}));

import { createRealResponseGenerator, EvalGuardError } from '../evaluation/real-response-generator';

describe.skip('createRealResponseGenerator', () => {
    beforeEach(() => {
        mockProcessMessage.mockReset();
    });

    it('정상 응답을 그대로 string으로 반환한다', async () => {
        mockProcessMessage.mockImplementation(async (_req, _docs, onToken) => {
            onToken('hello ');
            onToken('world');
            return 'hello world';
        });

        const gen = createRealResponseGenerator({ timeoutMs: 5000, maxTokensPerCase: 1000 });
        const result = await gen('q1');
        expect(result).toBe('hello world');
        expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    });

    it('timeoutMs 안에 응답이 안 오면 EvalGuardError("timeout") throw', async () => {
        // processMessage가 abortSignal을 받아 abort 시 ABORTED throw 하도록 모사
        mockProcessMessage.mockImplementation(async (req: { abortSignal?: AbortSignal }) => {
            return new Promise((_resolve, reject) => {
                const sig = req.abortSignal;
                if (!sig) return; // 영원히 pending
                const onAbort = () => reject(new Error('ABORTED'));
                if (sig.aborted) onAbort();
                else sig.addEventListener('abort', onAbort, { once: true });
            });
        });

        const gen = createRealResponseGenerator({ timeoutMs: 50, maxTokensPerCase: 1000 });
        const start = Date.now();
        await expect(gen('q-timeout')).rejects.toMatchObject({
            name: 'EvalGuardError',
            guard: 'timeout',
        });
        const elapsed = Date.now() - start;
        // 50ms timeout — 너무 늦게 reject되면 안 됨 (여유 1000ms)
        expect(elapsed).toBeLessThan(1100);
    });

    it('토큰 누적 추정이 maxTokensPerCase 초과 시 EvalGuardError("token-budget") throw', async () => {
        // chars/3 추정 → maxTokens=10 이면 chars=30 까지 허용, chars=33부터 abort
        // onToken으로 50 char 한 번에 흘려서 즉시 초과 유도
        mockProcessMessage.mockImplementation(async (req: { abortSignal?: AbortSignal }, _docs, onToken: (t: string) => void) => {
            onToken('x'.repeat(50)); // estimatedTokens = ceil(50/3) = 17 > 10
            // abort 신호 대기
            return new Promise((_resolve, reject) => {
                const sig = req.abortSignal;
                if (!sig) return;
                const onAbort = () => reject(new Error('ABORTED'));
                if (sig.aborted) onAbort();
                else sig.addEventListener('abort', onAbort, { once: true });
            });
        });

        const gen = createRealResponseGenerator({
            timeoutMs: 5000,
            maxTokensPerCase: 10,
            abortOnBudgetExceed: true,
        });

        // try/catch로 EvalGuardError stats까지 직접 검증
        let caught: unknown = null;
        try {
            await gen('q-tokens');
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(EvalGuardError);
        if (caught instanceof EvalGuardError) {
            expect(caught.guard).toBe('token-budget');
            expect(caught.stats.chars).toBeGreaterThanOrEqual(50);
            expect(caught.stats.estimatedTokens).toBeGreaterThan(10);
        }
    });

    it('abortOnBudgetExceed=false면 토큰 초과해도 abort 하지 않는다', async () => {
        mockProcessMessage.mockImplementation(async (_req, _docs, onToken: (t: string) => void) => {
            onToken('x'.repeat(100));
            return 'ok-' + 'x'.repeat(100);
        });

        const gen = createRealResponseGenerator({
            timeoutMs: 5000,
            maxTokensPerCase: 5,
            abortOnBudgetExceed: false,
        });

        const result = await gen('q-no-abort');
        expect(result.startsWith('ok-')).toBe(true);
    });

    it('processMessage가 abort와 무관한 일반 에러를 throw하면 그대로 전파', async () => {
        mockProcessMessage.mockImplementation(async () => {
            throw new Error('network down');
        });

        const gen = createRealResponseGenerator({ timeoutMs: 5000, maxTokensPerCase: 1000 });
        await expect(gen('q-err')).rejects.toThrow('network down');
    });

    it('language 파라미터를 ChatMessageRequest.userLanguagePreference로 전달', async () => {
        mockProcessMessage.mockImplementation(async (req: { userLanguagePreference?: string }) => {
            return `lang=${req.userLanguagePreference ?? 'unset'}`;
        });

        const gen = createRealResponseGenerator({ timeoutMs: 5000, maxTokensPerCase: 1000 });
        const result = await gen('hello', 'ko');
        expect(result).toBe('lang=ko');
    });
});
