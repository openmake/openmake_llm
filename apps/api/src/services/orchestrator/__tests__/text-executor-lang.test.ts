/**
 * text.reason 실행기 — 응답 언어에 맞는 머리글 (2026-09-15).
 *
 * 배경: system 은 ctx.lang 으로 골랐지만 user 본문 머리글("## 지시" 등)과 절단 표시는 항상 한국어였다.
 */
const callJson = jest.fn();
jest.mock('../http-call', () => ({
    callJson: (...args: unknown[]) => callJson(...args),
    extractChatText: () => 'ok',
    extractUsage: () => undefined,
}));
jest.mock('../capability-resolver', () => ({ resolveCapabilityTarget: jest.fn() }));

import { textExecutor } from '../executors/text';
import { ORCHESTRATOR } from '../../../config/capabilities';

const target = { fullId: 'local-llm:m', model: 'm', params: {} };

function run(lang: string) {
    const task = { id: 't2', capability: 'text.reason', instruction: 'Write a caption', refs: ['t1'], attachments: [] };
    const results = new Map([['t1', { taskId: 't1', capability: 'web.search', ok: true, text: 'y'.repeat(ORCHESTRATOR.RESULT_MAX_CHARS + 10), media: [] }]]);
    const ctx = { lang, userMessage: 'Draw a reading nook', results, attachments: new Map(), targets: new Map([['t2', target]]) };
    return textExecutor(task as never, ctx as never);
}

function userContent(): string {
    return callJson.mock.calls[0][1].body.messages[1].content;
}

beforeEach(() => callJson.mockReset().mockResolvedValue({}));

describe('textExecutor — 머리글 언어', () => {
    it('영어 턴은 머리글·절단 표시에 한글이 없다', async () => {
        await run('en');

        expect(userContent()).toContain('## Instruction');
        expect(userContent()).toContain('…(truncated)');
        expect(/\p{Script=Hangul}/u.test(userContent())).toBe(false);
    });

    it('한국어 턴은 한국어 머리글을 유지한다', async () => {
        await run('ko');

        expect(userContent()).toContain('## 지시');
        expect(userContent()).toContain('…(절단)');
    });
});

describe('textExecutor — 추론 끄기', () => {
    function body(t: object) {
        const task = { id: 't2', capability: 'text.reason', instruction: 'x', refs: [], attachments: [] };
        const ctx = { lang: 'ko', userMessage: 'y', results: new Map(), attachments: new Map(), targets: new Map([['t2', t]]) };
        return textExecutor(task as never, ctx as never).then(() => callJson.mock.calls[0][1].body);
    }

    it('로컬 모델은 enable_thinking=false 를 명시한다', async () => {
        expect((await body({ ...target, providerId: 'local-llm' })).chat_template_kwargs).toEqual({ enable_thinking: false });
    });

    it('외부 provider 에는 싣지 않는다', async () => {
        expect((await body({ fullId: 'hasa:m', model: 'hasa/m', providerId: 'hasa', params: {} })).chat_template_kwargs).toBeUndefined();
    });
});
