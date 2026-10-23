/**
 * 작업 종료 시 사용자 MCP 풀 참조 해제 + 유휴 TTL 회수 (2026-10-23 R6).
 *
 * - 작업이 띄운 per_chat 서버는 작업이 끝나면 닫는다 — 같은 사용자의 채팅·다른 작업이 열려 있으면 둔다.
 * - 채팅도 작업도 없고 마지막 활동이 TTL 을 넘긴 사용자의 풀은 통째로 닫는다(다음 채팅·작업이 멱등 재spawn).
 */
import { MCPLifecycleSupervisor } from '../lifecycle-supervisor';
import { UserMCPPool } from '../user-pool';

function mkRepo() {
    return {
        listUserServers: jest.fn().mockResolvedValue([]),
        getServerById: jest.fn(),
        decryptEnvForSpawn: jest.fn().mockResolvedValue({}),
        recordInstanceTransition: jest.fn().mockResolvedValue(undefined),
        recordToolsRefreshed: jest.fn().mockResolvedValue(undefined),
        getCatalogToolAllowlist: jest.fn().mockResolvedValue(null),
        listAutoSpawnUserIds: jest.fn().mockResolvedValue([]),
        closeOrphanInstances: jest.fn().mockResolvedValue(0),
    };
}

type FakeClient = { disconnect: jest.Mock; lastUsedAt: number };

function mkClientFactory(lastUsedAt = 0) {
    const created: Record<string, FakeClient> = {};
    const factory = jest.fn().mockImplementation((config: { id: string; user_id: string }) => {
        const client = {
            connect: jest.fn().mockResolvedValue(undefined),
            disconnect: jest.fn().mockResolvedValue(undefined),
            callTool: jest.fn(),
            on: jest.fn(),
            getPid: jest.fn().mockReturnValue(4242),
            getStatus: jest.fn().mockReturnValue({ status: 'connected' }),
            lastUsedAt,
        };
        created[`${config.user_id}:${config.id}`] = client;
        return client;
    });
    return { factory, created };
}

const mkRow = (id: string, lifecycle: 'per_chat' | 'per_session', userId = 'u-1') => ({
    id, user_id: userId, name: id, transport_type: 'stdio', command: 'echo', args: [], env: {}, url: null,
    visibility: 'user_private', catalog_template_id: 'mcp-filesystem', auto_spawn: true, enabled: true,
    created_at: '', updated_at: '', lifecycle,
});

function mkSupervisor(Supervisor: typeof MCPLifecycleSupervisor, Pool: typeof UserMCPPool, lastUsedAt = 0) {
    const userPool = new Pool();
    const repo = mkRepo();
    const rows = [mkRow('s-chat', 'per_chat'), mkRow('s-session', 'per_session'), mkRow('s-chat', 'per_chat', 'u-2'), mkRow('s-session', 'per_session', 'u-2')];
    repo.listUserServers.mockImplementation(async (userId: string) => rows.filter(r => r.user_id === userId));
    repo.getServerById.mockImplementation(async (id: string) => rows.find(r => r.id === id));
    const { factory, created } = mkClientFactory(lastUsedAt);
    const sv = new Supervisor({ userPool, repo: repo as never, clientFactory: factory as never });
    return { sv, userPool, created, repo, rows };
}

/** await 창을 결정적으로 열고 닫는 문 — enter() 는 대상 await 에 들어섰다는 신호 */
function mkGate() {
    let release!: () => void;
    let enter!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const reached = new Promise<void>(r => { enter = r; });
    return { gate, reached, release, enter };
}

describe('MCPLifecycleSupervisor — 작업 참조(R6)', () => {
    test('(a) task= 로 띄운 뒤 onTaskEnd → per_chat 만 kill 1회, per_session 유지', async () => {
        const { sv, userPool, created } = mkSupervisor(MCPLifecycleSupervisor, UserMCPPool);
        await sv.ensureUserServers('u-1', 'task=t1');
        expect(userPool.has('u-1', 's-chat')).toBe(true);

        await sv.onTaskEnd('u-1', 't1');

        expect(created['u-1:s-chat'].disconnect).toHaveBeenCalledTimes(1);
        expect(created['u-1:s-session'].disconnect).not.toHaveBeenCalled();
        expect(userPool.has('u-1', 's-chat')).toBe(false);
        expect(userPool.has('u-1', 's-session')).toBe(true);
    });

    test('(b) 같은 사용자 채팅이 열려 있으면 onTaskEnd 는 kill 0회', async () => {
        const { sv, userPool, created } = mkSupervisor(MCPLifecycleSupervisor, UserMCPPool);
        await sv.onChatStart('u-1', 'c1');
        await sv.ensureUserServers('u-1', 'task=t1');

        await sv.onTaskEnd('u-1', 't1');

        expect(created['u-1:s-chat'].disconnect).not.toHaveBeenCalled();
        expect(userPool.has('u-1', 's-chat')).toBe(true);
    });

    test('(a\') 같은 사용자의 다른 작업이 남아 있으면 둔다 — 마지막 작업이 끝날 때 kill', async () => {
        const { sv, created } = mkSupervisor(MCPLifecycleSupervisor, UserMCPPool);
        await sv.ensureUserServers('u-1', 'task=t1');
        await sv.ensureUserServers('u-1', 'task=t2');

        await sv.onTaskEnd('u-1', 't1');
        expect(created['u-1:s-chat'].disconnect).not.toHaveBeenCalled();
        await sv.onTaskEnd('u-1', 't2');
        expect(created['u-1:s-chat'].disconnect).toHaveBeenCalledTimes(1);
    });

    test('(e) ensure 에 닿지 않은 작업의 onTaskEnd 는 아무것도 닫지 않는다', async () => {
        const { sv, userPool, created } = mkSupervisor(MCPLifecycleSupervisor, UserMCPPool);
        await sv.ensureUserServers('u-1', 'boot');

        await sv.onTaskEnd('u-1', 't-never');

        expect(created['u-1:s-chat'].disconnect).not.toHaveBeenCalled();
        expect(userPool.has('u-1', 's-chat')).toBe(true);
    });

    test('(f) onTaskEnd 가 서버 목록을 기다리는 사이 같은 사용자 작업이 ensure 하면 닫지 않는다', async () => {
        const { sv, userPool, created, repo, rows } = mkSupervisor(MCPLifecycleSupervisor, UserMCPPool);
        await sv.ensureUserServers('u-1', 'task=t1');
        const g = mkGate();
        repo.listUserServers.mockImplementationOnce(async (userId: string) => {
            g.enter();
            await g.gate;
            return rows.filter(r => r.user_id === userId);
        });

        const ending = sv.onTaskEnd('u-1', 't1');
        await g.reached;
        await sv.ensureUserServers('u-1', 'task=t2');
        g.release();
        await ending;

        expect(created['u-1:s-chat'].disconnect).not.toHaveBeenCalled();
        expect(userPool.has('u-1', 's-chat')).toBe(true);
    });
});

describe('MCPLifecycleSupervisor.sweepIdleUsers(R6)', () => {
    const NOW = 10_000_000;
    const TTL = 1_800_000; // 기본값 30분

    test('(c) TTL 초과·채팅 0·작업 0 → 닫힘, 최근 활동 → 제외, 작업 참조 → 제외', async () => {
        const { sv, userPool, created } = mkSupervisor(MCPLifecycleSupervisor, UserMCPPool, NOW - TTL - 1);
        await sv.ensureUserServers('u-1', 'boot');          // 유휴 — 닫힌다
        await sv.ensureUserServers('u-2', 'task=t9');       // 유휴지만 작업이 잡고 있다 — 제외
        const recent = mkSupervisor(MCPLifecycleSupervisor, UserMCPPool, NOW - 1000);
        await recent.sv.ensureUserServers('u-1', 'boot');   // 최근 활동 — 제외

        expect(await sv.sweepIdleUsers(NOW)).toEqual(['u-1']);
        expect(created['u-1:s-chat'].disconnect).toHaveBeenCalledTimes(1);
        expect(created['u-1:s-session'].disconnect).toHaveBeenCalledTimes(1);
        expect([...userPool.forUser('u-1')]).toHaveLength(0);
        expect(userPool.has('u-2', 's-session')).toBe(true);

        expect(await recent.sv.sweepIdleUsers(NOW)).toEqual([]);
        expect(recent.created['u-1:s-session'].disconnect).not.toHaveBeenCalled();

        // 작업이 끝나면 다음 스윕에서 닫힌다(per_chat 은 onTaskEnd 가 먼저 닫는다)
        await sv.onTaskEnd('u-2', 't9');
        expect(await sv.sweepIdleUsers(NOW)).toEqual(['u-2']);
    });

    test('(e) 판정 뒤 앞 사용자를 닫는 사이 task= 가 들어온 사용자는 닫지 않는다', async () => {
        const { sv, userPool, created, repo } = mkSupervisor(MCPLifecycleSupervisor, UserMCPPool, NOW - TTL - 1);
        await sv.ensureUserServers('u-1', 'boot');
        await sv.ensureUserServers('u-2', 'boot');
        const g = mkGate();
        repo.recordInstanceTransition.mockImplementation(async (_s: string, userId: string, state: string) => {
            if (userId === 'u-1' && state === 'stopped') { g.enter(); await g.gate; }
        });

        const sweeping = sv.sweepIdleUsers(NOW);   // u-1·u-2 둘 다 유휴로 판정
        await g.reached;                            // u-1 을 닫는 중
        await sv.ensureUserServers('u-2', 'task=t1');
        g.release();

        expect(await sweeping).toEqual(['u-1']);
        expect(created['u-1:s-session'].disconnect).toHaveBeenCalledTimes(1);
        expect(created['u-2:s-session'].disconnect).not.toHaveBeenCalled();
        expect(userPool.has('u-2', 's-session')).toBe(true);
    });

    test('(c\') 채팅이 열린 사용자는 활동이 오래돼도 제외', async () => {
        const { sv, created } = mkSupervisor(MCPLifecycleSupervisor, UserMCPPool, NOW - TTL - 1);
        await sv.onChatStart('u-1', 'c1');

        expect(await sv.sweepIdleUsers(NOW)).toEqual([]);
        expect(created['u-1:s-session'].disconnect).not.toHaveBeenCalled();
    });

    test('(d) MCP_USER_POOL_IDLE_TTL_MS=0 → 아무것도 닫지 않는다', async () => {
        const prev = process.env.MCP_USER_POOL_IDLE_TTL_MS;
        process.env.MCP_USER_POOL_IDLE_TTL_MS = '0';
        try {
            let mods!: { S: typeof MCPLifecycleSupervisor; P: typeof UserMCPPool };
            jest.isolateModules(() => {
                mods = { S: require('../lifecycle-supervisor').MCPLifecycleSupervisor, P: require('../user-pool').UserMCPPool };
            });
            const { sv, userPool, created } = mkSupervisor(mods.S, mods.P, 0);
            await sv.ensureUserServers('u-1', 'boot');

            expect(await sv.sweepIdleUsers(NOW)).toEqual([]);
            expect(created['u-1:s-session'].disconnect).not.toHaveBeenCalled();
            expect(userPool.has('u-1', 's-session')).toBe(true);
        } finally {
            if (prev === undefined) delete process.env.MCP_USER_POOL_IDLE_TTL_MS; else process.env.MCP_USER_POOL_IDLE_TTL_MS = prev;
        }
    });
});
