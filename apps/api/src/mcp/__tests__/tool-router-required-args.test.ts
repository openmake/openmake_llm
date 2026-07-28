/**
 * executeTool 실행 시점 required 인자 검증 테스트.
 *
 * 회귀: inputSchema.required 가 LLM 노출용으로만 쓰여, 모델이 인자 JSON 을
 * 누락/절단해 보내면 undefined 가 핸들러 깊숙이 흘러들어 런타임 에러로 터졌다
 * (2026-07-17 web_search query 누락 → performWebSearch toLowerCase TypeError).
 * 수정: 내장 도구 실행 직전 chokepoint 에서 required 누락을 invalid_args 로 차단.
 */

const fakeHandler = jest.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
const noReqHandler = jest.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));

jest.mock('../tools', () => ({
    builtInTools: [
        {
            tool: {
                name: 'fake_search',
                description: 'test',
                inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
            },
            handler: (...a: unknown[]) => fakeHandler(...a as []),
        },
        {
            tool: {
                name: 'fake_noreq',
                description: 'test',
                inputSchema: { type: 'object', properties: {} },
            },
            handler: (...a: unknown[]) => noReqHandler(...a as []),
        },
    ],
}));

import { ToolRouter } from '../tool-router';

describe('ToolRouter.executeTool required 인자 검증', () => {
    beforeEach(() => { fakeHandler.mockClear(); noReqHandler.mockClear(); });

    it('required 인자 누락({}) → invalid_args 에러, 핸들러 미실행', async () => {
        const router = new ToolRouter();
        const result = await router.executeTool('fake_search', {});
        expect(result.isError).toBe(true);
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('필수 인자 누락 (fake_search): query');
        expect(text).toContain('[오류 유형: invalid_args]');
        expect(fakeHandler).not.toHaveBeenCalled();
    });

    it('required 인자가 null → 누락과 동일 취급', async () => {
        const router = new ToolRouter();
        const result = await router.executeTool('fake_search', { query: null as unknown as string });
        expect(result.isError).toBe(true);
        expect(fakeHandler).not.toHaveBeenCalled();
    });

    it('required 인자 제공 시 핸들러 정상 실행', async () => {
        const router = new ToolRouter();
        const result = await router.executeTool('fake_search', { query: '검색어' });
        expect(result.isError).toBeUndefined();
        expect(fakeHandler).toHaveBeenCalledTimes(1);
    });

    it('required 미선언 도구는 빈 인자로도 실행된다 (기존 동작 불변)', async () => {
        const router = new ToolRouter();
        const result = await router.executeTool('fake_noreq', {});
        expect(result.isError).toBeUndefined();
        expect(noReqHandler).toHaveBeenCalledTimes(1);
    });
});
