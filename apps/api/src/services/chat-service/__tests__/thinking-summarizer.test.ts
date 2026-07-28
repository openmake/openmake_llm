/** thinking 요약 세션 — 중간(진행형)/최종(과거형) 발행 규칙 */

const mockConfig = { thinkingSummaryEnabled: true, llmDefaultModel: 'qwen3.6-35b-a3b' };
jest.mock('../../../config', () => ({
    ...jest.requireActual('../../../config'),
    getConfig: () => mockConfig,
}));

const chatMock = jest.fn();
jest.mock('../../model-role-resolver', () => ({
    resolveRoleClientForUser: jest.fn(async () => ({
        client: { derive: () => ({ chat: chatMock }) },
        providerId: 'local-llm',
    })),
}));

// 진행 임계값을 테스트 친화적으로 축소 (모듈 로드 전에 env 설정)
process.env.THINKING_SUMMARY_PROGRESS_MIN_CHARS = '50';
process.env.THINKING_SUMMARY_PROGRESS_STEP_CHARS = '60';
process.env.THINKING_SUMMARY_PROGRESS_INTERVAL_MS = '0';

import { createThinkingSummarySession, summarizeThinking } from '../thinking-summarizer';

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
    chatMock.mockReset();
    mockConfig.thinkingSummaryEnabled = true;
    chatMock.mockResolvedValue({ content: '요약 헤드라인입니다' });
});

describe('summarizeThinking', () => {
    it('플래그 OFF → null (LLM 미호출)', async () => {
        mockConfig.thinkingSummaryEnabled = false;
        expect(await summarizeThinking('q', 'x'.repeat(100), 'u1')).toBeNull();
        expect(chatMock).not.toHaveBeenCalled();
    });

    it('짧은 생각(<20자) → null', async () => {
        expect(await summarizeThinking('q', '짧다', 'u1')).toBeNull();
        expect(chatMock).not.toHaveBeenCalled();
    });

    it('mode=progress → 현재진행형 규칙이 프롬프트에 포함', async () => {
        await summarizeThinking('q', 'x'.repeat(100), 'u1', 'progress');
        const sys = chatMock.mock.calls[0][0][0].content as string;
        expect(sys).toContain('현재진행형');
    });

    it('LLM 실패 → null (fail-open)', async () => {
        chatMock.mockRejectedValue(new Error('down'));
        expect(await summarizeThinking('q', 'x'.repeat(100), 'u1')).toBeNull();
    });
});

describe('createThinkingSummarySession', () => {
    it('임계값 도달 시 중간 요약 1회 발행, step 미달 시 추가 발행 없음', async () => {
        const emitted: string[] = [];
        const s = createThinkingSummarySession('질문', 'u1', (x) => emitted.push(x));
        s.onThinking('a'.repeat(55)); // ≥ MIN 50 → 중간 요약
        await flush();
        expect(emitted).toHaveLength(1);
        s.onThinking('b'.repeat(10)); // 신규 10 < STEP 60 → skip
        await flush();
        expect(emitted).toHaveLength(1);
        s.onThinking('c'.repeat(60)); // 신규 ≥ STEP → 두 번째 중간 요약
        await flush();
        expect(emitted).toHaveLength(2);
    });

    it('startFinal 은 멱등 — 1회만 호출되고 이후 중간 요약 중단', async () => {
        const emitted: string[] = [];
        const s = createThinkingSummarySession('질문', 'u1', (x) => emitted.push(x));
        s.onThinking('생각 내용 '.repeat(10));
        const p1 = s.startFinal();
        const p2 = s.startFinal();
        expect(p1).toBe(p2);
        await p1;
        const callsAfterFinal = chatMock.mock.calls.length;
        s.onThinking('x'.repeat(200)); // final 이후 중간 요약 없음
        await flush();
        expect(chatMock.mock.calls.length).toBe(callsAfterFinal);
    });

    it('생각 없이 startFinal → null resolve, LLM 미호출', async () => {
        const s = createThinkingSummarySession('질문', 'u1', () => {});
        expect(await s.startFinal()).toBeNull();
        expect(chatMock).not.toHaveBeenCalled();
    });

    it('getThinking — 누적 원문 반환 (영속화용)', () => {
        const s = createThinkingSummarySession('질문', 'u1', () => {});
        s.onThinking('하나 ');
        s.onThinking('둘');
        expect(s.getThinking()).toBe('하나 둘');
    });
});
