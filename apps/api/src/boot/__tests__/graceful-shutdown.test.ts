/**
 * 종료 모듈(boot/graceful-shutdown) — 운영 진입점(cli cluster)과 직접 실행(server.ts)이 같이 쓴다.
 * 실제 프로세스를 죽이지 않도록 process·exit 는 가짜를 주입한다.
 */
import { EventEmitter } from 'events';

const calls: string[] = [];

jest.mock('../../runtime-ports/tool-runtime', () => ({
    getToolRuntime: () => ({ shutdown: async () => { calls.push('tool-runtime'); } }),
}));
jest.mock('../../controllers/auth.controller', () => ({ stopOAuthCleanup: () => { calls.push('oauth'); } }));
jest.mock('../../monitoring/analytics', () => ({
    getAnalyticsSystem: () => ({ dispose: () => { calls.push('analytics'); } }),
}));
jest.mock('../../schedulers', () => ({ stopAllSchedulers: () => { calls.push('schedulers'); } }));
jest.mock('../../data/models/token-blacklist', () => ({ resetTokenBlacklist: () => { calls.push('token-blacklist'); } }));
jest.mock('../../observability/otel', () => ({ shutdownTelemetry: async () => { calls.push('otel'); } }));
jest.mock('../../data/models/unified-database', () => ({ closeDatabase: async () => { calls.push('db'); } }));

import {
    GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    createGracefulShutdown,
    installGracefulShutdown,
    type ShutdownProcess,
} from '../graceful-shutdown';

class FakeProcess extends EventEmitter implements ShutdownProcess {
    exit = jest.fn();
}

/** 밖에서 끝낼 수 있는 promise */
function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(() => {
    calls.length = 0;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('createGracefulShutdown', () => {
    it('단계를 순서대로, 앞 단계가 끝난 뒤에 다음 단계를 실행하고 주어진 코드로 종료한다', async () => {
        const proc = new FakeProcess();
        const first = deferred();
        const order: string[] = [];
        const shutdown = createGracefulShutdown([
            { name: 'a', run: async () => { order.push('a:start'); await first.promise; order.push('a:end'); } },
            { name: 'b', run: () => { order.push('b'); } },
        ], { proc });

        const done = shutdown('SIGTERM');
        await flush();
        expect(order).toEqual(['a:start']);
        expect(proc.exit).not.toHaveBeenCalled();

        first.resolve();
        await done;
        expect(order).toEqual(['a:start', 'a:end', 'b']);
        expect(proc.exit).toHaveBeenCalledTimes(1);
        expect(proc.exit).toHaveBeenCalledWith(0);
    });

    it('한 단계가 실패해도 나머지 단계를 계속 실행한다', async () => {
        const proc = new FakeProcess();
        const order: string[] = [];
        const shutdown = createGracefulShutdown([
            { name: 'a', run: () => { throw new Error('boom'); } },
            { name: 'b', run: async () => { throw new Error('boom2'); } },
            { name: 'c', run: () => { order.push('c'); } },
        ], { proc });

        await shutdown('SIGINT');
        expect(order).toEqual(['c']);
        expect(proc.exit).toHaveBeenCalledWith(0);
    });

    it('종료 진행 중에 다시 불리면 무시한다(재진입 가드)', async () => {
        const proc = new FakeProcess();
        const gate = deferred();
        const run = jest.fn(async () => { await gate.promise; });
        const shutdown = createGracefulShutdown([{ name: 'a', run }], { proc });

        const first = shutdown('SIGTERM');
        await shutdown('unhandledRejection', 1);
        expect(proc.exit).not.toHaveBeenCalled();

        gate.resolve();
        await first;
        expect(run).toHaveBeenCalledTimes(1);
        expect(proc.exit).toHaveBeenCalledTimes(1);
        expect(proc.exit).toHaveBeenCalledWith(0);
    });

    it('제한 시간을 넘기면 남은 단계를 기다리지 않고 강제 종료한다', async () => {
        jest.useFakeTimers();
        const proc = new FakeProcess();
        const later = jest.fn();
        const shutdown = createGracefulShutdown([
            { name: 'hang', run: () => new Promise<void>(() => undefined) },
            { name: 'later', run: later },
        ], { proc });

        const done = shutdown('SIGTERM');
        await jest.advanceTimersByTimeAsync(GRACEFUL_SHUTDOWN_TIMEOUT_MS - 1);
        expect(proc.exit).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        await done;
        expect(proc.exit).toHaveBeenCalledWith(0);
        expect(later).not.toHaveBeenCalled();
    });

    it('예외 경로는 넘겨받은 종료 코드 1 을 쓴다', async () => {
        const proc = new FakeProcess();
        const shutdown = createGracefulShutdown([], { proc });
        await shutdown('uncaughtException', 1);
        expect(proc.exit).toHaveBeenCalledWith(1);
    });
});

describe('installGracefulShutdown', () => {
    it('SIGINT·SIGTERM·uncaughtException·unhandledRejection 네 가지를 등록한다', () => {
        const proc = new FakeProcess();
        installGracefulShutdown({ stop: async () => undefined }, proc);
        for (const event of ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection']) {
            expect(proc.listenerCount(event)).toBe(1);
        }
    });

    it('SIGTERM — 서버 종료가 끝난 뒤 정리하고 DB 풀은 맨 마지막에 닫는다, 종료 코드 0', async () => {
        const proc = new FakeProcess();
        const stopped = deferred();
        const stop = jest.fn(async () => { calls.push('server:start'); await stopped.promise; calls.push('server:end'); });
        installGracefulShutdown({ stop }, proc);

        proc.emit('SIGTERM');
        await flush();
        // 서버가 연결을 다 정리하기 전에는 아무것도 닫지 않는다
        expect(calls).toEqual(['server:start']);

        stopped.resolve();
        await new Promise((r) => setImmediate(r));
        await flush();
        await new Promise((r) => setImmediate(r));
        expect(calls).toEqual([
            'server:start', 'server:end',
            'tool-runtime',
            'oauth', 'analytics', 'schedulers', 'token-blacklist',
            'otel',
            'db',
        ]);
        expect(proc.exit).toHaveBeenCalledWith(0);
    });

    it('SIGINT 도 같은 경로로 종료 코드 0', async () => {
        const proc = new FakeProcess();
        installGracefulShutdown({ stop: async () => undefined }, proc);
        proc.emit('SIGINT');
        await new Promise((r) => setTimeout(r, 50));
        expect(calls[calls.length - 1]).toBe('db');
        expect(proc.exit).toHaveBeenCalledWith(0);
    });

    it.each(['uncaughtException', 'unhandledRejection'])('%s 는 정리 뒤 종료 코드 1', async (event) => {
        const proc = new FakeProcess();
        installGracefulShutdown({ stop: async () => undefined }, proc);
        proc.emit(event, new Error('fatal'));
        await new Promise((r) => setTimeout(r, 50));
        expect(calls[calls.length - 1]).toBe('db');
        expect(proc.exit).toHaveBeenCalledTimes(1);
        expect(proc.exit).toHaveBeenCalledWith(1);
    });
});
