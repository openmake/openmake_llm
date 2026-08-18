import { MCPLifecycleSupervisor } from '../mcp/lifecycle-supervisor';
import { UserMCPPool } from '../mcp/user-pool';

interface MockRepo {
    listUserServers: jest.Mock;
    getServerById: jest.Mock;
    decryptEnvForSpawn: jest.Mock;
    recordInstanceTransition: jest.Mock;
    getCatalogToolAllowlist: jest.Mock;
}

function mkRepo(): MockRepo {
    return {
        listUserServers: jest.fn().mockResolvedValue([]),
        getServerById: jest.fn(),
        decryptEnvForSpawn: jest.fn().mockResolvedValue({}),
        recordInstanceTransition: jest.fn().mockResolvedValue(undefined),
        getCatalogToolAllowlist: jest.fn().mockResolvedValue(null),
    };
}

/** stdio 자식 프로세스 pid — 'running' 전이에 함께 기록되는지 검증하기 위한 고정값 */
const MOCK_PID = 4242;

function mkClientFactory() {
    const created: Array<{ serverId: string; client: unknown }> = [];
    const factory = jest.fn().mockImplementation((config: { id: string }) => {
        const client = {
            connect: jest.fn().mockResolvedValue(undefined),
            disconnect: jest.fn().mockResolvedValue(undefined),
            listTools: jest.fn().mockResolvedValue({ tools: [] }),
            callTool: jest.fn(),
            on: jest.fn(),
            getPid: jest.fn().mockReturnValue(MOCK_PID),
        };
        created.push({ serverId: config.id, client });
        return client;
    });
    return { factory, created };
}

const mkRow = (overrides: Record<string, unknown>) => ({
    id: overrides.id ?? 's-x',
    user_id: overrides.user_id ?? 'u-1',
    name: 's',
    transport_type: 'stdio',
    command: 'echo',
    args: [],
    env: {},
    url: null,
    visibility: 'user_private',
    catalog_template_id: 'mcp-filesystem',
    auto_spawn: overrides.auto_spawn ?? true,
    enabled: overrides.enabled ?? true,
    created_at: '',
    updated_at: '',
    lifecycle: overrides.lifecycle ?? 'per_session',
    ...overrides,
});

describe('MCPLifecycleSupervisor', () => {
    test('onUserLogin: auto_spawn=true + lifecycle=per_session 만 spawn', async () => {
        const userPool = new UserMCPPool();
        const repo = mkRepo();
        repo.listUserServers.mockResolvedValue([
            mkRow({ id: 's-session', lifecycle: 'per_session', auto_spawn: true }),
            mkRow({ id: 's-chat', lifecycle: 'per_chat', auto_spawn: true }),
            mkRow({ id: 's-off', lifecycle: 'per_session', auto_spawn: false }),
        ]);
        repo.getServerById.mockImplementation(async (id: string) =>
            mkRow({ id, lifecycle: id === 's-session' ? 'per_session' : 'per_chat' }));
        const { factory } = mkClientFactory();
        const sv = new MCPLifecycleSupervisor({ userPool, repo, clientFactory: factory });

        await sv.onUserLogin('u-1');

        expect(factory).toHaveBeenCalledTimes(1);
        expect(factory.mock.calls[0][0].id).toBe('s-session');
        expect(userPool.has('u-1', 's-session')).toBe(true);
        expect(userPool.has('u-1', 's-chat')).toBe(false);
        expect(userPool.has('u-1', 's-off')).toBe(false);
        expect(repo.recordInstanceTransition).toHaveBeenCalledWith('s-session', 'u-1', 'starting');
        // pid 를 함께 기록해야 헬스체크가 생존을 검증할 수 있다 (미전달 시 전량 NULL → missingPid 만 반환)
        expect(repo.recordInstanceTransition).toHaveBeenCalledWith('s-session', 'u-1', 'running', MOCK_PID);
    });

    test('onChatStart: per_chat + per_session(auto_spawn) ensure, auto_spawn=false 제외', async () => {
        const userPool = new UserMCPPool();
        const repo = mkRepo();
        repo.listUserServers.mockResolvedValue([
            mkRow({ id: 's-chat', lifecycle: 'per_chat' }),
            mkRow({ id: 's-session', lifecycle: 'per_session' }),
            mkRow({ id: 's-off', lifecycle: 'per_session', auto_spawn: false }),
        ]);
        repo.getServerById.mockImplementation(async (id: string) =>
            mkRow({ id, lifecycle: id === 's-chat' ? 'per_chat' : 'per_session' }));
        const { factory } = mkClientFactory();
        const sv = new MCPLifecycleSupervisor({ userPool, repo, clientFactory: factory });

        await sv.onChatStart('u-1', 'chat-x');

        // 세션 도중 설치/재시작 복구를 위해 per_session 도 채팅 시점에 ensure.
        expect(userPool.has('u-1', 's-chat')).toBe(true);
        expect(userPool.has('u-1', 's-session')).toBe(true);
        expect(userPool.has('u-1', 's-off')).toBe(false);
    });

    test('onChatEnd: per_chat 서버만 kill', async () => {
        const userPool = new UserMCPPool();
        const repo = mkRepo();
        repo.listUserServers.mockResolvedValue([
            mkRow({ id: 's-chat', lifecycle: 'per_chat' }),
            mkRow({ id: 's-session', lifecycle: 'per_session' }),
        ]);
        repo.getServerById.mockImplementation(async (id: string) =>
            mkRow({ id, lifecycle: id === 's-chat' ? 'per_chat' : 'per_session' }));
        const { factory } = mkClientFactory();
        const sv = new MCPLifecycleSupervisor({ userPool, repo, clientFactory: factory });

        await sv.onChatStart('u-1', 'chat-x');
        await sv.onUserLogin('u-1');
        expect(userPool.size()).toBe(2);

        await sv.onChatEnd('u-1', 'chat-x');

        expect(userPool.has('u-1', 's-chat')).toBe(false);
        expect(userPool.has('u-1', 's-session')).toBe(true);
        expect(repo.recordInstanceTransition).toHaveBeenCalledWith('s-chat', 'u-1', 'stopped');
    });

    test('onUserLogout: 사용자 모든 서버 kill', async () => {
        const userPool = new UserMCPPool();
        const repo = mkRepo();
        repo.listUserServers.mockResolvedValue([
            mkRow({ id: 's-1', lifecycle: 'per_session' }),
        ]);
        repo.getServerById.mockImplementation(async (id: string) =>
            mkRow({ id }));
        const { factory } = mkClientFactory();
        const sv = new MCPLifecycleSupervisor({ userPool, repo, clientFactory: factory });

        await sv.onUserLogin('u-1');
        expect(userPool.has('u-1', 's-1')).toBe(true);

        await sv.onUserLogout('u-1');
        expect(userPool.size()).toBe(0);
    });

    test('spawnUserServer: 명시적 호출 (start endpoint)', async () => {
        const userPool = new UserMCPPool();
        const repo = mkRepo();
        repo.getServerById.mockResolvedValue(mkRow({ id: 's-x', user_id: 'u-1' }));
        const { factory } = mkClientFactory();
        const sv = new MCPLifecycleSupervisor({ userPool, repo, clientFactory: factory });

        const client = await sv.spawnUserServer('u-1', 's-x');
        expect(client).toBeDefined();
        expect(userPool.has('u-1', 's-x')).toBe(true);
    });

    test('crash 시 풀에서 제거 + crashed 상태 기록', async () => {
        const userPool = new UserMCPPool();
        const repo = mkRepo();
        repo.getServerById.mockResolvedValue(mkRow({ id: 's-crash', user_id: 'u-1' }));
        const handlers: Record<string, (...args: unknown[]) => void> = {};
        const factory = jest.fn().mockImplementation(() => ({
            connect: jest.fn().mockResolvedValue(undefined),
            disconnect: jest.fn().mockResolvedValue(undefined),
            listTools: jest.fn().mockResolvedValue({ tools: [] }),
            callTool: jest.fn(),
            on: jest.fn().mockImplementation((event: string, fn: (...args: unknown[]) => void) => {
                handlers[event] = fn;
            }),
        }));
        const sv = new MCPLifecycleSupervisor({ userPool, repo, clientFactory: factory as never });

        await sv.spawnUserServer('u-1', 's-crash');
        expect(userPool.has('u-1', 's-crash')).toBe(true);

        handlers['exit']?.(137, null, 'SIGKILL');
        await new Promise(r => setTimeout(r, 50));

        expect(userPool.has('u-1', 's-crash')).toBe(false);
        expect(repo.recordInstanceTransition).toHaveBeenCalledWith(
            's-crash', 'u-1', 'crashed', undefined, expect.stringContaining('exit'),
        );
    });
});
