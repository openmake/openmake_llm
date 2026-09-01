/**
 * MCP docker 샌드박스 단위 테스트 — 게이트 + docker run 인자 조립 + loopback 치환.
 */
import { buildDockerArgs, buildSandboxedCommand, buildSandboxedEnv, rewriteLoopback, SandboxConfig } from '../sandbox-docker';

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
    ...over,
});

describe('rewriteLoopback', () => {
    it('127.0.0.1/localhost → host.docker.internal', () => {
        expect(rewriteLoopback('postgresql://u:p@127.0.0.1:5432/db')).toBe('postgresql://u:p@host.docker.internal:5432/db');
        expect(rewriteLoopback('http://localhost:4000')).toBe('http://host.docker.internal:4000');
        expect(rewriteLoopback('https://api.example.com')).toBe('https://api.example.com');
    });
});

describe('buildDockerArgs (pure)', () => {
    const input = { command: 'npx', args: ['-y', 'pkg'], serverId: 's1' };

    it('격리 플래그·이미지·원본 command 를 조립한다', () => {
        const a = buildDockerArgs(input, cfg());
        const s = a.join(' ');
        expect(a.slice(0, 4)).toEqual(['run', '--rm', '-i', '--init']);
        expect(s).toContain('--cap-drop ALL');
        expect(s).toContain('--security-opt no-new-privileges');
        expect(s).toContain('--pids-limit 256');
        expect(s).toContain('--memory 512m');
        expect(s).toContain('--cpus 1.0');
        expect(s).toContain('--user 1000:1000');
        // per-server 캐시 격리 (볼륨에 serverId suffix)
        expect(s).toContain('-v openmake-mcp-cache-s1:/home/node/.cache');
        // uvx 도구 venv 를 캐시 볼륨으로 — 없으면 readonly rootfs 에서 uvx 서버 전멸 (2026-09-01 실측)
        expect(s).toContain('-e UV_TOOL_DIR=/home/node/.cache/uv-tools');
        // loopback 미참조 서버엔 add-host 미부여 (over-grant 차단)
        expect(s).not.toContain('--add-host');
        // 이미지 뒤에 원본 command
        const imgIdx = a.indexOf('openmake-mcp-runtime:latest');
        expect(a.slice(imgIdx + 1)).toEqual(['npx', '-y', 'pkg']);
    });

    it('read-only opt-in 시 --read-only + tmpfs 추가', () => {
        const ro = buildDockerArgs(input, cfg({ readonly: true })).join(' ');
        expect(ro).toContain('--read-only');
        expect(ro).toContain('--tmpfs /tmp');
        expect(buildDockerArgs(input, cfg()).join(' ')).not.toContain('--read-only');
    });

    it('network full→bridge, none→none', () => {
        expect(buildDockerArgs({ ...input, network: 'full' }, cfg()).join(' ')).toContain('--network bridge');
        expect(buildDockerArgs({ ...input, network: 'none' }, cfg()).join(' ')).toContain('--network none');
    });

    it('config.env 는 이름만 -e 로 넣고 값은 인자에 노출하지 않는다', () => {
        const a = buildDockerArgs({ ...input, env: { FIRECRAWL_API_KEY: 'k1' } }, cfg());
        expect(a).toContain('-e');
        expect(a).toContain('FIRECRAWL_API_KEY');
        // 🔒 회귀 가드: 값이 커맨드라인에 baked 되면 `ps` 로 아무나 읽는다
        expect(a).not.toContain('FIRECRAWL_API_KEY=k1');
        expect(a.join(' ')).not.toContain('k1');
        // 호스트 env 가 통째로 들어가지 않음
        expect(a.some((x) => x.startsWith('DATABASE_URL'))).toBe(false);
    });

    it('buildSandboxedEnv 가 값을 돌려주고 loopback 을 치환한다', () => {
        const env = buildSandboxedEnv({ ...input, env: { FIRECRAWL_API_KEY: 'k1', DSN: 'redis://localhost:6379' } });
        expect(env.FIRECRAWL_API_KEY).toBe('k1');
        expect(env.DSN).toBe('redis://host.docker.internal:6379');
    });

    it('command/args 의 내부 loopback 을 host.docker.internal 로 치환', () => {
        const a = buildDockerArgs(
            { command: 'npx', args: ['server-postgres', 'postgresql://mcp:pw@127.0.0.1:5432/db'], serverId: 's2', env: { DSN: 'redis://localhost:6379' } },
            cfg(),
        );
        const s = a.join(' ');
        expect(s).toContain('host.docker.internal:5432');
        expect(s).not.toContain('127.0.0.1');
        expect(s).not.toContain('localhost:6379');
        // env 값(비밀 포함)은 인자에 없다
        expect(s).not.toContain('redis://');
        // loopback 참조 서버이므로 add-host 부여됨 (판정은 원본 env 값 기준)
        expect(s).toContain('--add-host host.docker.internal:host-gateway');
    });
});

describe('buildSandboxedCommand (gate)', () => {
    const input = { command: 'npx', args: ['-y', 'pkg'], serverId: 's1' };

    it('flag off → no-op', () => {
        const r = buildSandboxedCommand(input, cfg({ enabled: false }));
        expect(r.sandboxed).toBe(false);
        expect(r.command).toBe('npx');
        expect(r.args).toEqual(['-y', 'pkg']);
    });

    it('샌드박스 활성인데 docker 미발견 → fail-closed(throw, 비격리 실행 거부)', () => {
        expect(() => buildSandboxedCommand(input, cfg({ dockerPath: null }))).toThrow(/docker/i);
    });

    it("network='host' → opt-out no-op (게이트 ON 이어도 비격리)", () => {
        const r = buildSandboxedCommand({ ...input, network: 'host' }, cfg());
        expect(r.sandboxed).toBe(false);
        expect(r.command).toBe('npx');
        expect(r.args).toEqual(['-y', 'pkg']);
    });

    it('게이트 충족 → docker 래핑 (command=docker, 이미지 뒤 원본)', () => {
        const r = buildSandboxedCommand(input, cfg());
        expect(r.sandboxed).toBe(true);
        expect(r.command).toBe('/usr/local/bin/docker');
        expect(r.args[0]).toBe('run');
        const imgIdx = r.args.indexOf('openmake-mcp-runtime:latest');
        expect(r.args.slice(imgIdx + 1)).toEqual(['npx', '-y', 'pkg']);
    });
});
