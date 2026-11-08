/**
 * 사용자 MCP 서버 실행 격리 보강(2026-11-08 점검) — 사용자 소유 서버의 유효 네트워크는 egress 프록시 경유.
 */
import {
    buildDockerArgs, buildSandboxedCommand, defaultSandboxConfig, effectiveNetwork,
    MCP_SANDBOX_EGRESS_REQUIRED_CODE, MCP_SANDBOX_EGRESS_REQUIRED_MESSAGE, type SandboxConfig,
} from '../sandbox-docker';

const EGRESS = { network: 'omk-egress-internal', proxyUrl: 'http://omk-egress-proxy:8888' };

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
    userEgress: true,
    egress: EGRESS,
    ...over,
});

const input = { command: 'npx', args: ['-y', 'pkg'], serverId: 's1' };
const PROXY_ENV = [
    `HTTP_PROXY=${EGRESS.proxyUrl}`, `HTTPS_PROXY=${EGRESS.proxyUrl}`,
    `http_proxy=${EGRESS.proxyUrl}`, `https_proxy=${EGRESS.proxyUrl}`, 'NODE_USE_ENV_PROXY=1',
];

/** `-e` 다음 값들. */
function envArgs(args: string[]): string[] {
    return args.flatMap((a, i) => (args[i - 1] === '-e' ? [a] : []));
}

describe('effectiveNetwork', () => {
    it('none 은 소유와 무관하게 none', () => {
        expect(effectiveNetwork({ network: 'none', ownerScope: 'user' }, { userEgress: true })).toBe('none');
        expect(effectiveNetwork({ network: 'none', ownerScope: 'global' }, { userEgress: true })).toBe('none');
    });
    it('사용자 서버의 full·host·미지정은 userEgress 면 egress, 아니면 bridge', () => {
        for (const network of ['full', 'host', undefined] as const) {
            expect(effectiveNetwork({ network, ownerScope: 'user' }, { userEgress: true })).toBe('egress');
            expect(effectiveNetwork({ network, ownerScope: 'user' }, { userEgress: false })).toBe('bridge');
        }
    });
    it('전역 서버의 full·미지정은 bridge', () => {
        expect(effectiveNetwork({ network: 'full', ownerScope: 'global' }, { userEgress: true })).toBe('bridge');
        expect(effectiveNetwork({ network: undefined, ownerScope: undefined }, { userEgress: true })).toBe('bridge');
    });
});

describe('buildDockerArgs·buildSandboxedCommand — egress', () => {
    it('① 사용자+full → egress 망·프록시 env, bridge·--add-host 없음', () => {
        const r = buildSandboxedCommand({ ...input, network: 'full', ownerScope: 'user', args: ['http://localhost:1'] }, cfg());
        const j = r.args.join(' ');
        expect(r.sandboxed).toBe(true);
        expect(r.network).toBe('egress');
        expect(j).toContain('--network omk-egress-internal');
        expect(j).not.toContain('--network bridge');
        expect(r.args).not.toContain('--add-host');
        for (const e of PROXY_ENV) expect(envArgs(r.args)).toContain(e);
    });

    it('② 사용자+host → 같은 egress(비격리 아님)', () => {
        const r = buildSandboxedCommand({ ...input, network: 'host', ownerScope: 'user' }, cfg());
        expect(r.sandboxed).toBe(true);
        expect(r.network).toBe('egress');
        expect(r.args.join(' ')).toContain('--network omk-egress-internal');
    });

    it('③ 사용자+none → --network none, 프록시 env 없음', () => {
        const r = buildSandboxedCommand({ ...input, network: 'none', ownerScope: 'user' }, cfg());
        expect(r.network).toBe('none');
        expect(r.args.join(' ')).toContain('--network none');
        expect(envArgs(r.args).some((e) => /PROXY/i.test(e))).toBe(false);
    });

    it('④ 전역+full → bridge, cfg.egress 가 있어도 프록시 env 없음', () => {
        const r = buildSandboxedCommand({ ...input, network: 'full', ownerScope: 'global' }, cfg());
        expect(r.network).toBe('bridge');
        expect(r.args.join(' ')).toContain('--network bridge');
        expect(envArgs(r.args).some((e) => /PROXY/i.test(e))).toBe(false);
    });

    it('⑤ 사용자+full+userEgress 인데 cfg.egress 없음 → MCP_SANDBOX_EGRESS_REQUIRED 로 거부', () => {
        let err: unknown;
        try { buildSandboxedCommand({ ...input, network: 'full', ownerScope: 'user' }, cfg({ egress: undefined })); } catch (e) { err = e; }
        expect(err).toBeInstanceOf(Error);
        expect((err as { code?: string }).code).toBe('MCP_SANDBOX_EGRESS_REQUIRED');
        expect(MCP_SANDBOX_EGRESS_REQUIRED_CODE).toBe('MCP_SANDBOX_EGRESS_REQUIRED');
        expect((err as Error).message).toBe(MCP_SANDBOX_EGRESS_REQUIRED_MESSAGE);
        expect(() => buildDockerArgs({ ...input, ownerScope: 'user' }, cfg({ egress: undefined }))).toThrow(MCP_SANDBOX_EGRESS_REQUIRED_MESSAGE);
    });

    it('⑥ userEgress:false → 종전 bridge, 프록시 env 없음', () => {
        const r = buildSandboxedCommand({ ...input, network: 'full', ownerScope: 'user' }, cfg({ userEgress: false, egress: undefined }));
        expect(r.network).toBe('bridge');
        expect(r.args.join(' ')).toContain('--network bridge');
        expect(envArgs(r.args).some((e) => /PROXY/i.test(e))).toBe(false);
    });

    it('⑧ 프록시 -e 들은 서버 -e KEY 뒤에 온다', () => {
        const r = buildSandboxedCommand({ ...input, ownerScope: 'user', env: { API_KEY: 'v' } }, cfg());
        const keyIdx = r.args.indexOf('API_KEY');
        expect(keyIdx).toBeGreaterThan(0);
        for (const e of PROXY_ENV) expect(r.args.indexOf(e)).toBeGreaterThan(keyIdx);
        expect(r.args.indexOf('NODE_USE_ENV_PROXY=1')).toBeLessThan(r.args.indexOf('openmake-mcp-runtime:latest'));
    });

    it('⑨ 서버 env 의 HTTP_PROXY 는 제어 키라 -e 이름 목록에 없고 런타임 값만 들어간다', () => {
        const r = buildSandboxedCommand({ ...input, ownerScope: 'user', env: { HTTP_PROXY: 'http://other:1', OK: '1' } }, cfg());
        const names = envArgs(r.args);
        expect(names).toContain('OK');
        expect(names).not.toContain('HTTP_PROXY');
        expect(names.filter((e) => e.startsWith('HTTP_PROXY'))).toEqual([`HTTP_PROXY=${EGRESS.proxyUrl}`]);
        expect(r.env).not.toHaveProperty('HTTP_PROXY');
    });
});

describe('defaultSandboxConfig().userEgress (⑦)', () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const saved = process.env.MCP_SANDBOX_USER_EGRESS;
    afterEach(() => {
        process.env.NODE_ENV = savedNodeEnv;
        if (saved === undefined) delete process.env.MCP_SANDBOX_USER_EGRESS;
        else process.env.MCP_SANDBOX_USER_EGRESS = saved;
    });

    it.each(['production', 'test'])('NODE_ENV=%s — 미설정이면 true, false 명시면 false', (nodeEnv) => {
        process.env.NODE_ENV = nodeEnv;
        delete process.env.MCP_SANDBOX_USER_EGRESS;
        expect(defaultSandboxConfig().userEgress).toBe(true);
        process.env.MCP_SANDBOX_USER_EGRESS = 'false';
        expect(defaultSandboxConfig().userEgress).toBe(false);
        expect(defaultSandboxConfig().egress).toBeUndefined();
    });
});
