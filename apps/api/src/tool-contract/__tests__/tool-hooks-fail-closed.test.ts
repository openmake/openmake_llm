/**
 * 도구 훅 fail-closed (하네스 검토 C-08) — failClosed 훅만 예외를 거절·결과 보류로 바꾸고, 일반 훅은 종전대로 fail-open.
 */
import {
    registerToolHook, runPreHooks, runPostHooks, __resetToolHooksForTest,
    hookFailureDenyMessage, hookFailureWithheldMessage,
} from '../tool-hooks';

const ctx = { name: 'bash', external: false, startedAt: Date.now(), surface: 'task' as const };
const ok = { content: [{ type: 'text' as const, text: 'ok' }] };

beforeEach(() => __resetToolHooksForTest());

describe('fail-closed 훅', () => {
    it('일반 훅의 pre 예외는 무시하고 다음 훅으로 넘어간다(종전 동작)', async () => {
        registerToolHook({ id: 'flaky', pre: () => { throw new Error('boom'); } });
        registerToolHook({ id: 'next', pre: (a) => ({ args: { ...a, seen: true } }) });
        expect(await runPreHooks({ a: 1 }, ctx)).toEqual({ args: { a: 1, seen: true } });
    });

    it('failClosed 훅의 pre 예외는 거절이 되고, 뒤 훅은 돌지 않는다 — 원인 메시지는 결과에 싣지 않는다', async () => {
        const later = jest.fn();
        registerToolHook({ id: 'secret-scan', failClosed: true, pre: () => { throw new Error('db password=hunter2'); } });
        registerToolHook({ id: 'later', pre: later });
        const r = await runPreHooks({ a: 1 }, ctx);
        expect(r.deny).toBe(hookFailureDenyMessage('secret-scan'));
        expect(r.deny).not.toContain('hunter2');
        expect(later).not.toHaveBeenCalled();
    });

    it('failClosed 훅의 post 예외는 결과를 보류(isError)로 바꾼다', async () => {
        registerToolHook({ id: 'dlp', failClosed: true, post: () => { throw new Error('scanner down'); } });
        const r = await runPostHooks(ok, ctx);
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toBe(hookFailureWithheldMessage('dlp'));
    });

    it('일반 훅의 post 예외는 원래 결과를 그대로 돌려준다(종전 동작)', async () => {
        registerToolHook({ id: 'flaky', post: () => { throw new Error('boom'); } });
        expect(await runPostHooks(ok, ctx)).toBe(ok);
    });

    it('failClosed 훅도 예외가 없으면 일반 훅과 같다(deny·치환)', async () => {
        registerToolHook({ id: 'guard', failClosed: true, pre: (a) => (a.cmd === 'rm' ? { deny: '금지' } : undefined) });
        expect(await runPreHooks({ cmd: 'ls' }, ctx)).toEqual({ args: { cmd: 'ls' } });
        expect((await runPreHooks({ cmd: 'rm' }, ctx)).deny).toBe('금지');
    });
});
