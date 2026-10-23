/**
 * MCP docker 샌드박스 단위 테스트 — 게이트 + docker run 인자 조립 + loopback 치환.
 */
import { buildDockerArgs, buildSandboxedCommand, buildSandboxedEnv, rewriteLoopback, SandboxConfig } from '../sandbox-docker';
import { needsPlaywrightBrowser, shellQuote, wrapWithPlaywrightInstall } from '../sandbox-playwright';

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
        // 고아 스윕 식별 라벨 — role(스코프)·pid(생존 판정)·serverId(진단)
        expect(s).toContain('--label openmake.role=mcp-sandbox');
        expect(s).toContain('--label openmake.pid=12345');
        expect(s).toContain('--label openmake.serverId=s1');
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

    it('dockerHost 가 있으면 docker 프로세스 env 로 넘긴다 — 컨테이너에는 넣지 않는다', () => {
        const r = buildSandboxedCommand(
            { ...input, env: { API_KEY: 'k1' } },
            cfg({ dockerHost: 'unix:///Users/u/.colima/openmake/docker.sock' }),
        );
        expect(r.env).toEqual({ API_KEY: 'k1', DOCKER_HOST: 'unix:///Users/u/.colima/openmake/docker.sock' });
        expect(r.args.join(' ')).not.toContain('DOCKER_HOST');
    });

    it('dockerHost 가 없으면 env 에 DOCKER_HOST 를 넣지 않는다', () => {
        const r = buildSandboxedCommand({ ...input, env: { API_KEY: 'k1' } }, cfg());
        expect(r.env).toEqual({ API_KEY: 'k1' });
    });

    it('서버 설정의 DOCKER_* 는 버린다 — 서버가 docker 접속처를 바꾸지 못하고, 컨테이너에도 들어가지 않는다', () => {
        const r = buildSandboxedCommand(
            { ...input, env: { DOCKER_HOST: 'tcp://evil:2375', DOCKER_CONTEXT: 'desktop-linux', docker_tls_verify: '0', API_KEY: 'k1' } },
            cfg({ dockerHost: 'unix:///sock' }),
        );
        expect(r.env).toEqual({ API_KEY: 'k1', DOCKER_HOST: 'unix:///sock' });
        const joined = r.args.join(' ');
        expect(joined).toContain('-e API_KEY');
        expect(joined).not.toMatch(/DOCKER_/i);
    });

    it('호스트 접속처가 없어도(Linux·기존 설치본) 서버 설정의 DOCKER_* 는 버린다', () => {
        const r = buildSandboxedCommand(
            { ...input, env: { DOCKER_HOST: 'tcp://evil:2375', DOCKER_CONTEXT: 'x' } },
            cfg(),
        );
        expect(r.env).toEqual({});
        expect(r.args.join(' ')).not.toMatch(/DOCKER_/i);
    });

    it('서버 설정의 제어 env(NODE_OPTIONS·LD_PRELOAD)는 컨테이너에 넣지 않는다', () => {
        const r = buildSandboxedCommand({ ...input, env: { NODE_OPTIONS: '--require /x', LD_PRELOAD: '/x.so', HOME: '/cache', API_KEY: 'k1' } }, cfg());
        expect(r.env).toEqual({ HOME: '/cache', API_KEY: 'k1' });
        expect(r.args.join(' ')).not.toContain('NODE_OPTIONS');
    });

    it('git 제어 env(GIT_DIR·GIT_TRACE)도 컨테이너에 넣지 않는다(#1471)', () => {
        const r = buildSandboxedCommand({ ...input, env: { GIT_DIR: '/x/.git', GIT_TRACE: '/tmp/t', GIT_TOKEN: 't1' } }, cfg());
        expect(r.env).toEqual({ GIT_TOKEN: 't1' });
    });
});

describe('playwright 브라우저 사전 설치 래핑 (sandbox-playwright)', () => {
    const noapi = { command: 'uvx', args: ['--with', 'mcp<2', 'noapi-google-search-mcp==0.3.2'], serverId: 'g1' };

    it('noapi uvx 서버 → 마지막 인자가 sh -c <script>, 같은 venv 로 install 후 exec', () => {
        const a = buildDockerArgs(noapi, cfg());
        const img = a.indexOf('openmake-mcp-runtime:latest');
        expect(a.slice(img + 1, img + 3)).toEqual(['sh', '-c']);
        expect(a.length).toBe(img + 4);
        const script = a[a.length - 1];
        expect(script).toContain("'uvx' '--with' 'mcp<2' '--from' 'noapi-google-search-mcp==0.3.2' python -m playwright install 'chromium'");
        expect(script).toContain("exec 'uvx' '--with' 'mcp<2' 'noapi-google-search-mcp==0.3.2'");
        // 설치 출력은 stderr 로 — MCP JSON-RPC stdout 오염 금지, stdin 도 넘기지 않는다
        expect(script).toMatch(/playwright install 'chromium' <\/dev\/null >&2 \|\| true; exec 'uvx' /);
    });

    it('Playwright MCP npx 서버 → 같은 npm 패키지로 chrome-for-testing 설치 후 exec', () => {
        const input = {
            command: 'npx',
            args: ['-y', '@playwright/mcp@0.0.79', '--headless', '--browser', 'chromium'],
            serverId: 'playwright-mcp',
        };
        expect(needsPlaywrightBrowser(input)).toBe(true);

        const a = buildDockerArgs(input, cfg());
        const img = a.indexOf('openmake-mcp-runtime:latest');
        expect(a.slice(img + 1, img + 3)).toEqual(['sh', '-c']);
        const script = a[a.length - 1];
        expect(script).toContain("'npx' '-y' '@playwright/mcp@0.0.79' 'install-browser' 'chrome-for-testing'");
        expect(script).toContain("exec 'npx' '-y' '@playwright/mcp@0.0.79' '--headless' '--browser' 'chromium' '--isolated'");
    });

    it('다른 uvx/npx 서버 → 래핑 없이 종전 그대로', () => {
        for (const input of [
            { command: 'uvx', args: ['mcp-server-fetch'], serverId: 'f1' },
            { command: 'npx', args: ['-y', 'pkg'], serverId: 'n1' },
        ]) {
            const a = buildDockerArgs(input, cfg());
            expect(a.slice(-(input.args.length + 1))).toEqual([input.command, ...input.args]);
            expect(a).not.toContain('sh');
        }
    });

    it('env OMK_PLAYWRIGHT_BROWSERS opt-in uvx 서버 → 래핑(값의 브라우저 목록 설치)', () => {
        const input = { command: 'uvx', args: ['some-browser-mcp'], serverId: 'b1', env: { OMK_PLAYWRIGHT_BROWSERS: 'chromium,firefox' } };
        expect(needsPlaywrightBrowser(input)).toBe(true);
        const script = buildDockerArgs(input, cfg()).slice(-1)[0];
        expect(script).toContain("'--from' 'some-browser-mcp' python -m playwright install 'chromium' 'firefox'");
        expect(script).toContain("exec 'uvx' 'some-browser-mcp'");
    });

    it('판정: uvx 가 아니면 플래그가 있어도 false, 빈 플래그는 무시', () => {
        expect(needsPlaywrightBrowser({ command: 'npx', args: ['x'], env: { OMK_PLAYWRIGHT_BROWSERS: 'chromium' } })).toBe(false);
        expect(needsPlaywrightBrowser({ command: 'uvx', args: ['x'], env: { OMK_PLAYWRIGHT_BROWSERS: '' } })).toBe(false);
        expect(needsPlaywrightBrowser({ command: 'uvx', args: ['noapi-google-search-mcp'] })).toBe(true);
    });

    it('--from 이 이미 있으면 그 스펙을 그대로 쓰고 실행 이름은 설치에서 뺀다', () => {
        const s = wrapWithPlaywrightInstall('uvx', ['--from', 'noapi-google-search-mcp==0.3.2', 'noapi-google-search-mcp']);
        expect(s).toEqual(['sh', '-c', expect.stringContaining("'uvx' '--from' 'noapi-google-search-mcp==0.3.2' python -m playwright install 'chromium'")]);
        expect(s[2]).toContain("exec 'uvx' '--from' 'noapi-google-search-mcp==0.3.2' 'noapi-google-search-mcp'");
    });

    it('인용 헬퍼: 공백·작은따옴표·셸 메타문자를 안전하게 감싼다', () => {
        expect(shellQuote("a b")).toBe("'a b'");
        expect(shellQuote("it's")).toBe("'it'\\''s'");
        expect(shellQuote('$(rm -rf /);`x`')).toBe("'$(rm -rf /);`x`'");
        const s = wrapWithPlaywrightInstall('uvx', ['--with', "x'; touch /tmp/p; '", 'noapi-google-search-mcp'])[2];
        expect(s).toContain("'--with' 'x'\\''; touch /tmp/p; '\\'''");
    });
});
