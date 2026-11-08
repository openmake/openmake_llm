/**
 * 사용자 MCP 서버 실행 격리 보강(2026-11-08 점검) — spawn 전에 egress 프록시를 보장하고 설정에 싣는다.
 */
import { prepareSandboxConfig } from '../sandbox-egress';
import { MCP_SANDBOX_EGRESS_REQUIRED_MESSAGE, type SandboxConfig } from '../sandbox-docker';
import { getTaskSandboxConfig } from '../../../config/task-sandbox';

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
    ...over,
});

const USER = { network: 'full' as const, ownerScope: 'user' as const };

describe('prepareSandboxConfig', () => {
    it.each([
        ['전역 서버', { network: 'full' as const, ownerScope: 'global' as const }, {}],
        ['사용자 none', { network: 'none' as const, ownerScope: 'user' as const }, {}],
        ['userEgress:false', USER, { userEgress: false }],
        ['enabled:false', USER, { enabled: false }],
        ['dockerPath:null', USER, { dockerPath: null }],
    ])('%s → undefined, ensure 호출 없음', async (_n, input, over) => {
        const ensure = jest.fn().mockResolvedValue('http://omk-egress-proxy:8888');
        await expect(prepareSandboxConfig(input, cfg(over as Partial<SandboxConfig>), ensure)).resolves.toBeUndefined();
        expect(ensure).not.toHaveBeenCalled();
    });

    it('사용자+full → ensure 1회(같은 docker), egress 망·프록시 URL 을 싣는다', async () => {
        const ensure = jest.fn().mockResolvedValue('http://omk-egress-proxy:8888');
        const base = cfg();
        const r = await prepareSandboxConfig(USER, base, ensure);
        expect(ensure).toHaveBeenCalledTimes(1);
        expect(ensure.mock.calls[0][0].dockerPath).toBe('/usr/local/bin/docker');
        expect(r).toEqual({ ...base, egress: { network: getTaskSandboxConfig().egressNetwork, proxyUrl: 'http://omk-egress-proxy:8888' } });
    });

    it('동시 호출 3건은 ensure 1회(single-flight), 끝난 뒤 다시 부르면 다시 1회', async () => {
        let release: ((v: string) => void) | undefined;
        const ensure = jest.fn().mockImplementation(() => new Promise<string>((res) => { release = res; }));
        const p = Promise.all([1, 2, 3].map(() => prepareSandboxConfig(USER, cfg(), ensure)));
        for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
        if (!release) throw new Error('ensure 가 호출되지 않았다');
        release('http://omk-egress-proxy:8888');
        const rs = await p;
        expect(ensure).toHaveBeenCalledTimes(1);
        for (const r of rs) expect(r?.egress?.proxyUrl).toBe('http://omk-egress-proxy:8888');

        const ensure2 = jest.fn().mockResolvedValue('http://omk-egress-proxy:8888');
        await prepareSandboxConfig(USER, cfg(), ensure2);
        expect(ensure2).toHaveBeenCalledTimes(1);
    });

    it('ensure 실패 → MCP_SANDBOX_EGRESS_REQUIRED 로 거부', async () => {
        const ensure = jest.fn().mockRejectedValue(new Error('image not found'));
        let err: unknown;
        try { await prepareSandboxConfig(USER, cfg(), ensure); } catch (e) { err = e; }
        expect((err as { code?: string }).code).toBe('MCP_SANDBOX_EGRESS_REQUIRED');
        expect((err as Error).message.startsWith(MCP_SANDBOX_EGRESS_REQUIRED_MESSAGE)).toBe(true);
        // 실패 뒤에도 다음 호출은 다시 보장을 시도한다
        const ensure2 = jest.fn().mockResolvedValue('http://omk-egress-proxy:8888');
        await expect(prepareSandboxConfig(USER, cfg(), ensure2)).resolves.toBeDefined();
        expect(ensure2).toHaveBeenCalledTimes(1);
    });
});
