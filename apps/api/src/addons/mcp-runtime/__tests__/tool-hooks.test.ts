/**
 * 도구 훅 레지스트리(F13.5) — 순서(서킷 → 역할 → pre → 호출 → post), deny, 인자 치환, 예외 fail-open, 해제.
 */
jest.mock('../../../config/env', () => ({ getConfig: () => ({ mcpToolListStaleMs: 0 }) }));
import { ToolRouter } from '../tool-router';
import { registerToolHook, runPreHooks, runPostHooks, __resetToolHooksForTest, listToolHookIds } from '../../../tool-contract/tool-hooks';
import { __resetCircuitsForTest } from '../../../tool-contract/tool-health';

const ctx = { name: 'srv::echo', external: true, startedAt: Date.now() };

function makeRouter(executor = jest.fn(async (_n: string, a: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: `echo:${JSON.stringify(a)}` }] }))) {
    const router = new ToolRouter();
    router.registerExternalTools('srv-1', 'srv', [{ name: 'echo', description: 't', inputSchema: { type: 'object', properties: {} } }], executor);
    return { router, executor };
}
const textOf = (r: { content: Array<{ text?: string }> }) => r.content.map((c) => c.text ?? '').join('');

beforeEach(() => { __resetToolHooksForTest(); __resetCircuitsForTest(); });

describe('runPreHooks / runPostHooks', () => {
    it('훅 0개면 인자·결과를 그대로 돌려준다', async () => {
        expect(await runPreHooks({ a: 1 }, ctx)).toEqual({ args: { a: 1 } });
        const r = { content: [{ type: 'text' as const, text: 'x' }] };
        expect(await runPostHooks(r, ctx)).toBe(r);
    });
    it('deny 첫 건에서 멈추고, 인자 치환은 순서대로 누적된다', async () => {
        const later = jest.fn();
        registerToolHook({ id: 'a', pre: (a) => ({ args: { ...a, a: 2 } }) });
        registerToolHook({ id: 'b', pre: () => ({ deny: 'no' }) });
        registerToolHook({ id: 'c', pre: later });
        const r = await runPreHooks({ a: 1 }, ctx);
        expect(r).toEqual({ args: { a: 2 }, deny: 'no' });
        expect(later).not.toHaveBeenCalled();
    });
    it('예외는 삼키고 다음 훅으로 간다(fail-open), 같은 id 는 교체, 해제 함수가 뺀다', async () => {
        registerToolHook({ id: 'boom', pre: () => { throw new Error('x'); } });
        const off = registerToolHook({ id: 'ok', pre: (a) => ({ args: { ...a, ok: true } }) });
        expect((await runPreHooks({}, ctx)).args).toEqual({ ok: true });
        registerToolHook({ id: 'ok', pre: (a) => ({ args: { ...a, ok: 'replaced' } }) });
        expect((await runPreHooks({}, ctx)).args).toEqual({ ok: 'replaced' });
        off();
        expect(listToolHookIds()).toEqual(['boom']);
    });
});

describe('ToolRouter × 훅', () => {
    it('pre 훅의 인자 치환이 실제 호출에 반영되고 post 훅이 결과를 바꾼다', async () => {
        const { router, executor } = makeRouter();
        registerToolHook({
            id: 'rewrite',
            pre: (a) => ({ args: { ...a, injected: 1 } }),
            post: (r) => ({ ...r, content: [{ type: 'text', text: textOf(r) + '|post' }] }),
        });
        const r = await router.executeTool('srv::echo', { q: 'x' }, { userId: 'u1', role: 'user' } as never);
        expect(executor).toHaveBeenCalledWith('echo', { q: 'x', injected: 1 });
        expect(textOf(r)).toBe('echo:{"q":"x","injected":1}|post');
    });
    it('deny 는 호출 없이 isError 로 돌아오고 서킷 실패로 세지 않는다', async () => {
        const { router, executor } = makeRouter();
        registerToolHook({ id: 'deny', pre: () => ({ deny: '업무 시간 외' }) });
        const r = await router.executeTool('srv::echo', {}, { userId: 'u1', role: 'user' } as never);
        expect(r.isError).toBe(true);
        expect(textOf(r)).toContain('업무 시간 외');
        expect(executor).not.toHaveBeenCalled();
    });
    it('post 훅은 컨텍스트에 시작 시각·사용자를 받는다', async () => {
        const { router } = makeRouter();
        const seen: unknown[] = [];
        registerToolHook({ id: 'obs', post: (_r, c) => { seen.push(c); } });
        await router.executeTool('srv::echo', {}, { userId: 7, role: 'admin' } as never);
        expect(seen[0]).toMatchObject({ name: 'srv::echo', external: true, userId: '7', role: 'admin' });
        expect(typeof (seen[0] as { startedAt: number }).startedAt).toBe('number');
    });
});
