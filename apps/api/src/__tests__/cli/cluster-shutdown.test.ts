/**
 * 운영 진입점 `cli.js cluster` 가 종료 모듈(boot/graceful-shutdown)을 등록하는지.
 * 종전에는 SIGINT 에 stop()+exit(0) 만 했고 SIGTERM·예외 핸들러가 없었다.
 */
export {};

const installGracefulShutdown = jest.fn();
const dashboard = { start: jest.fn(async () => undefined), stop: jest.fn(async () => undefined), url: 'http://localhost:0' };
const createDashboardServer = jest.fn((_options?: { port?: number }) => dashboard);

// commander·chalk 는 ESM 전용이라 jest CJS 런타임이 못 읽는다 — cli.ts 가 쓰는 만큼만 흉내 낸다.
jest.mock('commander', () => {
    type Handler = (...args: unknown[]) => unknown;
    class Command {
        private subcommands = new Map<string, Command>();
        private handler?: Handler;
        name(): this { return this; }
        description(): this { return this; }
        version(): this { return this; }
        option(): this { return this; }
        help(): void { /* noop */ }
        command(spec: string): Command {
            const sub = new Command();
            this.subcommands.set(spec.split(' ')[0], sub);
            return sub;
        }
        action(fn: Handler): this { this.handler = fn; return this; }
        parse(argv: string[]): void {
            const sub = this.subcommands.get(argv[2]);
            void sub?.handler?.({ port: argv[4] });
        }
    }
    return { Command };
});
jest.mock('chalk', () => {
    const id = (s: string): string => s;
    return { __esModule: true, default: { cyan: id, green: id, gray: id, red: id, underline: id } };
});
jest.mock('../../boot/graceful-shutdown', () => ({ installGracefulShutdown }));
jest.mock('../../dashboard', () => ({ createDashboardServer }));
jest.mock('../../addon-host/contributions', () => ({ contributedCliCommands: () => [] }));
jest.mock('../../ui/banner', () => ({ showBanner: () => undefined }));
jest.mock('../../ui/spinner', () => ({
    createSpinner: () => ({ start: () => undefined, succeed: () => undefined, fail: () => undefined, stop: () => undefined }),
}));

describe('cli cluster — 종료 처리 등록', () => {
    const originalArgv = process.argv;
    afterEach(() => {
        process.argv = originalArgv;
        jest.restoreAllMocks();
    });

    it('대시보드 서버를 종료 모듈에 넘기고, 자체 SIGINT 핸들러는 달지 않는다', async () => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const sigintBefore = process.listenerCount('SIGINT');
        process.argv = ['node', 'cli.js', 'cluster', '--port', '0'];

        require('../../cli');
        for (let i = 0; i < 20 && dashboard.start.mock.calls.length === 0; i++) {
            await new Promise((r) => setImmediate(r));
        }
        await new Promise((r) => setImmediate(r));

        expect(createDashboardServer).toHaveBeenCalledTimes(1);
        expect(dashboard.start).toHaveBeenCalledTimes(1);
        expect(installGracefulShutdown).toHaveBeenCalledTimes(1);
        expect(installGracefulShutdown).toHaveBeenCalledWith(dashboard);
        // 종료 처리는 서버 시작 전에 등록한다 — 부팅 중 SIGTERM 도 같은 경로로 정리한다
        expect(installGracefulShutdown.mock.invocationCallOrder[0]).toBeLessThan(dashboard.start.mock.invocationCallOrder[0]);
        expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
    });
});
