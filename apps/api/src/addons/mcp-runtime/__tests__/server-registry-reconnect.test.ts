/**
 * 전역 registry 자동 재연결 — 부팅 연결 실패·예기치 않은 종료 뒤 지수 백오프로 다시 붙는다(2026-09-30).
 * 재부팅 직후 Docker 재기동과 함께 끊긴 전역 서버(noapi-google-search)가 다시 붙지 않던 결함.
 */
import { EventEmitter } from 'events';

jest.mock('../../../config/timeouts', () => ({
    ...jest.requireActual('../../../config/timeouts'),
    MCP_GLOBAL_RECONNECT: { BASE_DELAY_MS: 1000, MAX_DELAY_MS: 4000, MAX_ATTEMPTS: 3, STABLE_MS: 60_000 },
}));

type FakeClient = EventEmitter & { connect: jest.Mock; disconnect: jest.Mock; getTools: jest.Mock; callTool: jest.Mock };
const clients: FakeClient[] = [];
/** 생성 순서대로 connect 결과를 정한다 — true 면 성공 */
let connectPlan: boolean[] = [];

jest.mock('../external-client', () => ({
    ExternalMCPClient: jest.fn().mockImplementation(() => {
        const c = new EventEmitter() as FakeClient;
        const ok = connectPlan.shift() ?? true;
        c.connect = jest.fn(() => (ok ? Promise.resolve() : Promise.reject(new Error('docker not ready'))));
        c.disconnect = jest.fn().mockResolvedValue(undefined);
        c.getTools = jest.fn().mockReturnValue([]);
        c.callTool = jest.fn();
        clients.push(c);
        return c;
    }),
}));

import { MCPServerRegistry } from '../server-registry';
import type { MCPServerConfig } from '../../../tool-contract/types';
import type { UnifiedDatabase } from '../../../data/models/unified-database';

const config: MCPServerConfig = {
    id: 'g1', name: 'global-search', transport_type: 'stdio', command: 'uvx', args: ['pkg'],
    enabled: true, created_at: '2026-01-01', updated_at: '2026-01-01',
} as MCPServerConfig;

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('MCPServerRegistry 자동 재연결', () => {
    let router: { registerExternalTools: jest.Mock; unregisterExternalTools: jest.Mock };
    let registry: MCPServerRegistry;

    beforeEach(() => {
        jest.useFakeTimers();
        clients.length = 0;
        connectPlan = [];
        router = { registerExternalTools: jest.fn(), unregisterExternalTools: jest.fn() };
        registry = new MCPServerRegistry(router as never);
    });
    afterEach(async () => {
        await registry.disconnectAll();
        jest.useRealTimers();
    });

    it('예기치 않은 종료 → 도구를 내리고 백오프 후 다시 연결해 도구를 재등록한다', async () => {
        await registry.connectServer('g1', config);
        expect(router.registerExternalTools).toHaveBeenCalledTimes(1);

        clients[0].emit('exit');
        expect(router.unregisterExternalTools).toHaveBeenCalledWith('g1');

        await jest.advanceTimersByTimeAsync(1000);
        await flush();
        expect(clients).toHaveLength(2);
        expect(router.registerExternalTools).toHaveBeenCalledTimes(2);
        expect(registry.getClient('g1')).toBe(clients[1]);
    });

    it('부팅 연결 실패 → 재시도, 실패가 이어지면 백오프가 늘고 상한에서 멈춘다', async () => {
        connectPlan = [false, false, false, false];
        const db = { getGlobalMcpServers: jest.fn().mockResolvedValue([{ ...config, env: null, url: null }]) };
        await registry.initializeFromDB(db as unknown as UnifiedDatabase);
        expect(clients).toHaveLength(1);

        await jest.advanceTimersByTimeAsync(1000);   // 1회차
        await flush();
        expect(clients).toHaveLength(2);
        await jest.advanceTimersByTimeAsync(1999);   // 2회차는 2000ms 뒤
        await flush();
        expect(clients).toHaveLength(2);
        await jest.advanceTimersByTimeAsync(1);
        await flush();
        expect(clients).toHaveLength(3);
        await jest.advanceTimersByTimeAsync(4000);   // 3회차(상한)
        await flush();
        expect(clients).toHaveLength(4);
        await jest.advanceTimersByTimeAsync(60_000); // 상한 초과 — 더 시도하지 않는다
        await flush();
        expect(clients).toHaveLength(4);
    });

    it('부팅 실패 뒤 재시도가 성공하면 도구를 등록한다', async () => {
        connectPlan = [false, true];
        const db = { getGlobalMcpServers: jest.fn().mockResolvedValue([{ ...config, env: null, url: null }]) };
        await registry.initializeFromDB(db as unknown as UnifiedDatabase);
        expect(router.registerExternalTools).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1000);
        await flush();
        expect(router.registerExternalTools).toHaveBeenCalledTimes(1);
    });

    it('수동 해제는 예약된 재연결을 취소한다', async () => {
        await registry.connectServer('g1', config);
        clients[0].emit('exit');
        await registry.disconnectServer('g1');

        await jest.advanceTimersByTimeAsync(10_000);
        await flush();
        expect(clients).toHaveLength(1);
    });

    it('교체된 옛 client 의 exit 는 무시한다', async () => {
        await registry.connectServer('g1', config);
        await registry.connectServer('g1', config);
        clients[0].emit('exit');

        await jest.advanceTimersByTimeAsync(10_000);
        await flush();
        expect(clients).toHaveLength(2);
    });
});
