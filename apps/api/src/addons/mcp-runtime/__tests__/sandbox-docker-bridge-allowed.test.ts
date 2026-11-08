/**
 * 관리자 bridge 허용 옵션(2026-11-08 점검 후속) — 관리자가 허용한 사용자 서버는 bridge, 그 밖은 종전 판정.
 */
import { buildSandboxedCommand, effectiveNetwork, type SandboxConfig } from '../sandbox-docker';

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

const input = { command: 'npx', args: ['-y', 'pkg', 'http://localhost:1'], serverId: 's1' };

/** `-e` 다음 값들. */
function envArgs(args: string[]): string[] {
    return args.flatMap((a, i) => (args[i - 1] === '-e' ? [a] : []));
}

describe('effectiveNetwork — bridgeAllowed', () => {
    it('사용자+full+userEgress+bridgeAllowed → bridge', () => {
        expect(effectiveNetwork({ network: 'full', ownerScope: 'user', bridgeAllowed: true }, { userEgress: true })).toBe('bridge');
    });
    it('사용자+none+bridgeAllowed → none', () => {
        expect(effectiveNetwork({ network: 'none', ownerScope: 'user', bridgeAllowed: true }, { userEgress: true })).toBe('none');
    });
    it('사용자+full, bridgeAllowed false·미지정 → egress(종전)', () => {
        expect(effectiveNetwork({ network: 'full', ownerScope: 'user', bridgeAllowed: false }, { userEgress: true })).toBe('egress');
        expect(effectiveNetwork({ network: 'full', ownerScope: 'user' }, { userEgress: true })).toBe('egress');
    });
    it('전역+bridgeAllowed → bridge(영향 없음)', () => {
        expect(effectiveNetwork({ network: 'full', ownerScope: 'global', bridgeAllowed: true }, { userEgress: true })).toBe('bridge');
    });
});

describe('buildSandboxedCommand — bridgeAllowed', () => {
    it('① 사용자+full+bridgeAllowed → --network bridge, 프록시 env·--add-host 없음', () => {
        const r = buildSandboxedCommand({ ...input, network: 'full', ownerScope: 'user', bridgeAllowed: true }, cfg());
        const j = r.args.join(' ');
        expect(r.sandboxed).toBe(true);
        expect(r.network).toBe('bridge');
        expect(j).toContain('--network bridge');
        expect(j).not.toContain('--network omk-egress-internal');
        expect(r.args).not.toContain('--add-host');
        expect(envArgs(r.args).some((e) => /PROXY/i.test(e))).toBe(false);
        // 사용자 서버의 loopback 은 그대로 둔다
        expect(r.args).toContain('http://localhost:1');
    });

    it('② cfg.egress 가 없어도 bridgeAllowed 면 거부하지 않는다', () => {
        const r = buildSandboxedCommand({ ...input, network: 'full', ownerScope: 'user', bridgeAllowed: true }, cfg({ egress: undefined }));
        expect(r.network).toBe('bridge');
    });

    it('③ 사용자+none+bridgeAllowed → --network none', () => {
        const r = buildSandboxedCommand({ ...input, network: 'none', ownerScope: 'user', bridgeAllowed: true }, cfg());
        expect(r.network).toBe('none');
        expect(r.args.join(' ')).toContain('--network none');
    });

    it('④ 사용자+full, bridgeAllowed:false → egress(종전)', () => {
        const r = buildSandboxedCommand({ ...input, network: 'full', ownerScope: 'user', bridgeAllowed: false }, cfg());
        expect(r.network).toBe('egress');
        expect(r.args.join(' ')).toContain('--network omk-egress-internal');
    });
});
