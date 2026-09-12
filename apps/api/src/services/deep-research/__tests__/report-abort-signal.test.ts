/**
 * 보고서 생성 abort/timeout 배선 회귀 테스트.
 *
 * 2026-09-13 라이브: `reportClient.chat(...)` 이 `signal` 없이 호출돼 SDK 의 timeout 옵션에만
 * 의존했다. SDK timeout 은 **스트리밍이 시작되면 해제**되므로 15분 상한이 27분 동안 무효였고,
 * 사용자의 연구 중단도 호출이 끝난 뒤에야 반영됐다(throwIfAborted 는 호출 이후에만 돈다).
 *
 * 다른 단계(chatWithAbortTimeout)와 같이 signal 로 걸렸는지 고정한다 — 되돌리면 실패한다.
 */
import { generateReport } from '../report-generator';
import type { LLMClient } from '../../../llm';
import { LLM_TIMEOUTS } from '../../../config/timeouts';

jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ addResearchStep: jest.fn().mockResolvedValue(undefined) }),
}));

describe('보고서 생성 abort 배선', () => {
    const buildClient = (capture: { signal?: AbortSignal }) => {
        const chat = jest.fn(async (
            _messages: unknown,
            _options: unknown,
            _onToken: unknown,
            advanced?: { signal?: AbortSignal },
        ) => {
            capture.signal = advanced?.signal;
            return { role: 'assistant' as const, content: '## 요약\n본문 [출처 1]\n\n## 주요 발견사항\n1. 항목 [출처 1]' };
        });
        const client = { chat, derive: jest.fn(() => client) } as unknown as LLMClient;
        return client;
    };

    const baseParams = (client: LLMClient, abortSignal?: AbortSignal) => ({
        client,
        config: { language: 'ko' } as never,
        topic: '주제',
        findings: ['중간 합성 결과 [출처 1]'],
        sources: [{ title: '자료', url: 'https://example.com/a', snippet: '내용' }] as never,
        subTopics: [{ title: '서브', searchQueries: ['q'], importance: 3 }] as never,
        sessionId: 'sess-1',
        abortSignal,
        throwIfAborted: () => { /* noop */ },
    });

    it('상위 abort signal 이 upstream 호출까지 전달된다', async () => {
        const capture: { signal?: AbortSignal } = {};
        const controller = new AbortController();
        await generateReport(baseParams(buildClient(capture), controller.signal));

        expect(capture.signal).toBeInstanceOf(AbortSignal);
        expect(capture.signal!.aborted).toBe(false);
        controller.abort();
        expect(capture.signal!.aborted).toBe(true);   // 결합 signal 이므로 상위 중단이 전파된다
    });

    it('상위 signal 이 없어도 타임아웃 signal 은 걸린다', async () => {
        const capture: { signal?: AbortSignal } = {};
        await generateReport(baseParams(buildClient(capture)));
        expect(capture.signal).toBeInstanceOf(AbortSignal);
    });

    it('보고서 타임아웃이 라이브 실측(1,615초)보다 크다', () => {
        expect(LLM_TIMEOUTS.REPORT_GENERATION_TIMEOUT_MS).toBeGreaterThan(1615 * 1000);
    });
});
