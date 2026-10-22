/**
 * W3 S2 — 운영(NODE_ENV=production)에서 MCP 샌드박스 기본 ON + 비격리 사용자 서버 spawn 거부.
 */
import { buildSandboxedCommand, defaultSandboxConfig, MCP_SANDBOX_REQUIRED_MESSAGE, type SandboxConfig } from '../sandbox-docker';
import { MCPLifecycleSupervisor } from '../lifecycle-supervisor';
import { UserMCPPool } from '../user-pool';
import { recordSecurityAudit } from '../../../runtime-ports/audit-port';

jest.mock('../../../runtime-ports/audit-port', () => ({ recordSecurityAudit: jest.fn().mockResolvedValue(undefined) }));

const cfg = (over: Partial<SandboxConfig> = {}): SandboxConfig => ({
    enabled: true,
    dockerPath: '/usr/local/bin/docker',
    image: 'openmake-mcp-runtime:latest',
    cacheVolume: 'openmake-mcp-cache',
    memory: '512m',
    pidsLimit: 256,
    cpus: '1.0',
    user: '1000:1000',
    readonly: false,
    ownerPid: 12345,
    ...over,
});

const input = { command: 'npx', args: ['-y', 'pkg'], serverId: 's1' };

describe('MCP 샌드박스 운영 기본값·사용자 서버 격리 (S2)', () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedEnabled = process.env.MCP_SANDBOX_ENABLED;
    afterEach(() => {
        process.env.NODE_ENV = savedNodeEnv;
        if (savedEnabled === undefined) delete process.env.MCP_SANDBOX_ENABLED;
        else process.env.MCP_SANDBOX_ENABLED = savedEnabled;
    });

    it('(a) production·샌드박스 꺼짐·사용자 서버 → MCP_SANDBOX_REQUIRED 로 거부', () => {
        process.env.NODE_ENV = 'production';
        let err: unknown;
        try { buildSandboxedCommand({ ...input, ownerScope: 'user' }, cfg({ enabled: false })); } catch (e) { err = e; }
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe(MCP_SANDBOX_REQUIRED_MESSAGE);
        expect((err as { code?: string }).code).toBe('MCP_SANDBOX_REQUIRED');
        // docker 부재도 같은 거부
        expect(() => buildSandboxedCommand({ ...input, ownerScope: 'user' }, cfg({ dockerPath: null })))
            .toThrow(MCP_SANDBOX_REQUIRED_MESSAGE);
    });

    it('(b) production·샌드박스 꺼짐·관리자 전역 서버 → 비격리 원본 그대로', () => {
        process.env.NODE_ENV = 'production';
        const r = buildSandboxedCommand({ ...input, ownerScope: 'global' }, cfg({ enabled: false }));
        expect(r).toEqual({ command: 'npx', args: ['-y', 'pkg'], sandboxed: false });
    });

    it('(c) production 사용자 서버는 network=host opt-out 을 무시하고 격리한다', () => {
        process.env.NODE_ENV = 'production';
        const r = buildSandboxedCommand({ ...input, network: 'host', ownerScope: 'user' }, cfg());
        expect(r.sandboxed).toBe(true);
        expect(r.command).toBe('/usr/local/bin/docker');
        // host opt-out 은 bridge 로 격리(호스트 네트워크를 주지 않는다)
        expect(r.args.join(' ')).toContain('--network bridge');
        // 전역 서버의 host opt-out 은 종전대로 비격리
        expect(buildSandboxedCommand({ ...input, network: 'host', ownerScope: 'global' }, cfg()).sandboxed).toBe(false);
    });

    it('(d) test 환경·샌드박스 꺼짐·사용자 서버 → 종전대로 비격리', () => {
        process.env.NODE_ENV = 'test';
        const r = buildSandboxedCommand({ ...input, ownerScope: 'user' }, cfg({ enabled: false }));
        expect(r).toEqual({ command: 'npx', args: ['-y', 'pkg'], sandboxed: false });
        expect(buildSandboxedCommand({ ...input, network: 'host', ownerScope: 'user' }, cfg()).sandboxed).toBe(false);
    });

    it('(e) production 에서 MCP_SANDBOX_ENABLED 미설정 → 켜짐, false 명시 → 꺼짐 (test 미설정은 종전 꺼짐)', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.MCP_SANDBOX_ENABLED;
        expect(defaultSandboxConfig().enabled).toBe(true);
        process.env.MCP_SANDBOX_ENABLED = 'false';
        expect(defaultSandboxConfig().enabled).toBe(false);
        process.env.NODE_ENV = 'test';
        delete process.env.MCP_SANDBOX_ENABLED;
        expect(defaultSandboxConfig().enabled).toBe(false);
    });

    it('(f) 사용자 서버 spawn 이 MCP_SANDBOX_REQUIRED 로 거부되면 mcp_server.spawn_refused 감사 1건', async () => {
        const repo = {
            getServerById: jest.fn().mockResolvedValue({
                id: 's-9', user_id: 'u-1', name: 's', transport_type: 'stdio', command: 'echo', args: [],
            }),
            decryptEnvForSpawn: jest.fn().mockResolvedValue({}),
            recordInstanceTransition: jest.fn().mockResolvedValue(undefined),
        };
        const refused = Object.assign(new Error(MCP_SANDBOX_REQUIRED_MESSAGE), { code: 'MCP_SANDBOX_REQUIRED' });
        const factory = jest.fn().mockReturnValue({ connect: jest.fn().mockRejectedValue(refused), on: jest.fn() });
        const sv = new MCPLifecycleSupervisor({ userPool: new UserMCPPool(), repo: repo as never, clientFactory: factory as never });
        await expect(sv.spawnUserServer('u-1', 's-9')).rejects.toBe(refused);
        expect(recordSecurityAudit).toHaveBeenCalledTimes(1);
        expect(recordSecurityAudit).toHaveBeenCalledWith({
            action: 'mcp_server.spawn_refused', userId: 'u-1', resourceType: 'mcp_server', resourceId: 's-9',
            details: { reason: 'sandbox_required' },
        });
    });
});
