/**
 * 확장 MCP 서버 정책(§8-3) — URL·명령 매처(우회 케이스 포함)·판정·정책 해석(fail-closed) 고정.
 */
import { resetConfig } from '../../../config/env';
import {
    normalizeMcpServerUrl,
    describeMcpServer,
    evaluateMcpServer,
    loadExtensionMcpServerGate,
    assertMcpServerAllowed,
    resetExtensionMcpServerPolicyState,
    type ExtensionMcpServerPolicyDeps,
    type McpServerSpec,
} from '../mcp-server-policy';
import {
    parseExtensionMcpServerPolicy,
    extensionMcpServerPolicyProblems,
    type ExtensionMcpServerPolicyLayer,
    type ExtensionMcpServerRule,
} from '../../../config/extension-mcp-server-policy';
import { parseOrgPolicyRows } from '../../org/effective-policy';
import { ExtensionMcpServerBlockedError } from '../../../errors/extension-mcp-server-blocked.error';

const KEYS = ['EXTENSION_MCP_SERVER_POLICY_ENFORCED', 'EXTENSION_MCP_SERVER_POLICY'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
    resetExtensionMcpServerPolicyState();
});

const layer = (p: { allow?: ExtensionMcpServerRule[]; deny?: ExtensionMcpServerRule[] }, scope: 'global' | 'organization' = 'global'): ExtensionMcpServerPolicyLayer =>
    ({ ...(p.allow ? { allow: p.allow } : {}), deny: p.deny ?? [], scope });

const remote = (url: string): McpServerSpec => ({ transport: 'streamable-http', url });
const stdio = (line: string): McpServerSpec => { const [command, ...args] = line.split(' '); return { transport: 'stdio', command, args }; };
const stdioArgs = (command: string, args: string[]): McpServerSpec => ({ transport: 'stdio', command, args });

function allowed(spec: McpServerSpec, layers: ExtensionMcpServerPolicyLayer[]): boolean {
    return evaluateMcpServer({ server: describeMcpServer(spec), layers }).allowed;
}
const allowOnly = (rules: ExtensionMcpServerRule[]) => [layer({ allow: rules })];
const denyOnly = (rules: ExtensionMcpServerRule[]) => [layer({ deny: rules })];

describe('normalizeMcpServerUrl — 정규화(우회 차단의 바탕)', () => {
    it.each([
        ['HTTPS://MCP.Example.COM:443/v1/', 'https://mcp.example.com/v1'],
        ['https://user:pw@mcp.example.com/a/../v1//x?key=secret#frag', 'https://mcp.example.com/v1/x'],
        ['https://mcp.example.com./v1', 'https://mcp.example.com/v1'],
        ['https://mcp.example.com/%76%31', 'https://mcp.example.com/v1'],
        ['http://0x7f.1:8080/', 'http://127.0.0.1:8080'],
        ['https://mcp.example.com', 'https://mcp.example.com'],
    ])('%s → %s', (raw, expected) => {
        expect(normalizeMcpServerUrl(raw)).toBe(expected);
    });
    it.each(['ftp://mcp.example.com', 'not a url', '', 'file:///etc/passwd', 'javascript:alert(1)'])('식별 불가: %s', (raw) => {
        expect(normalizeMcpServerUrl(raw)).toBeNull();
    });
});

describe('describeMcpServer — stdio 명령 식별', () => {
    const pkgOf = (spec: McpServerSpec) => {
        const d = describeMcpServer(spec);
        if (d.kind !== 'stdio') throw new Error(d.kind);
        return { command: d.primary.command, family: d.primary.family, pkg: d.primary.pkg };
    };
    it('npx — 스코프 이름 소문자 + 버전', () => {
        expect(pkgOf(stdio('npx -y @Scope/Pkg@1.2.3'))).toEqual({ command: 'npx', family: 'npm', pkg: { name: '@scope/pkg', version: '1.2.3' } });
    });
    it('npx --package 가 위치 인자보다 우선, 값 플래그를 건너뛴다', () => {
        expect(pkgOf(stdio('npx --package=@a/b@2 run-b')).pkg).toEqual({ name: '@a/b', version: '2' });
        expect(pkgOf(stdio('npx --registry https://r.example.com real-pkg')).pkg).toEqual({ name: 'real-pkg' });
    });
    it('npm exec · pnpm dlx 는 npm 계열 실행기', () => {
        expect(pkgOf(stdio('npm exec @a/b'))).toMatchObject({ command: 'npm', family: 'npm', pkg: { name: '@a/b' } });
        expect(pkgOf(stdio('pnpm dlx @a/b@3'))).toMatchObject({ command: 'pnpm', family: 'npm', pkg: { name: '@a/b', version: '3' } });
        expect(pkgOf(stdio('npm install @a/b')).family).toBeUndefined();
    });
    it('uvx — PEP 503 이름 정규화, --from 우선, == 고정', () => {
        expect(pkgOf(stdio('uvx Mcp_Server.Fetch'))).toMatchObject({ family: 'python', pkg: { name: 'mcp-server-fetch' } });
        expect(pkgOf(stdio('uvx --from Mcp_Server==1.0 mcp-server')).pkg).toEqual({ name: 'mcp-server', version: '1.0' });
        expect(pkgOf(stdio('uvx pkg>=1.0')).pkg).toEqual({ name: 'pkg' });
    });
    it('docker run — 기본 레지스트리 정규화 + 태그·digest, 값 플래그 건너뜀', () => {
        expect(pkgOf(stdio('docker run -i --rm -e TOKEN=x ghcr.io/Org/Img:1.0')).pkg).toEqual({ name: 'ghcr.io/org/img', version: '1.0' });
        expect(pkgOf(stdio('docker run mcp/fetch')).pkg).toEqual({ name: 'docker.io/mcp/fetch' });
        expect(pkgOf(stdio('docker run nginx:latest')).pkg).toEqual({ name: 'docker.io/library/nginx' });
        expect(pkgOf(stdio('podman run index.docker.io/mcp/fetch@sha256:abc')).pkg).toEqual({ name: 'docker.io/mcp/fetch', version: 'sha256:abc' });
    });
    it('env 앞머리·Windows 확장자·경로', () => {
        expect(pkgOf(stdio('env FOO=1 -u BAR npx pkg'))).toMatchObject({ command: 'npx', pkg: { name: 'pkg' } });
        expect(pkgOf(stdio('npx.cmd pkg')).command).toBe('npx');
        expect(pkgOf(stdioArgs('C:\\Bin\\NPX.EXE', ['pkg'])).command).toBe('c:/bin/npx');
    });
    it('인자 값은 식별 문자열에 싣지 않는다', () => {
        expect(describeMcpServer(stdio('npx pkg --token=SECRET')).display).toBe('npx pkg');
        expect(describeMcpServer(remote('https://mcp.example.com/v1?api_key=SECRET')).display).toBe('https://mcp.example.com/v1');
    });
});

describe('url 규칙 — allow 정확', () => {
    const rules = allowOnly([{ type: 'url', url: 'https://mcp.example.com/v1' }]);
    it.each([
        ['https://mcp.example.com/v1', true],
        ['https://MCP.example.com/v1/tools', true],
        ['https://mcp.example.com/v1/', true],
        ['https://mcp.example.com:443/v1', true],
        ['https://mcp.example.com/v10', false],          // 구간 접두만
        ['https://mcp.example.com/V1', false],           // allow 경로는 대소문자 구분
        ['http://mcp.example.com/v1', false],            // 스킴
        ['https://mcp.example.com:8443/v1', false],      // 포트
        ['https://mcp.example.com.evil.com/v1', false],  // 접미 호스트
        ['https://mcp.example.com@evil.com/v1', false],  // userinfo 속임
        ['https://mcp.example.com/v1/../admin', false],  // 점 경로
        ['https://mcp.example.com/', false],
    ])('%s → %s', (url, ok) => {
        expect(allowed(remote(url), rules)).toBe(ok);
    });
    it('호스트 와일드카드는 하위 도메인만', () => {
        const w = allowOnly([{ type: 'url', url: 'https://*.example.com' }]);
        expect(allowed(remote('https://a.b.example.com/x'), w)).toBe(true);
        expect(allowed(remote('https://example.com/x'), w)).toBe(false);
        expect(allowed(remote('https://evilexample.com/x'), w)).toBe(false);
    });
    it('url 규칙은 stdio 서버에 맞지 않는다(반대도)', () => {
        expect(allowed(stdio('npx pkg'), rules)).toBe(false);
        expect(allowed(remote('https://mcp.example.com/v1'), allowOnly([{ type: 'command', command: 'npx' }]))).toBe(false);
    });
});

describe('url 규칙 — deny 넓게', () => {
    const rules = denyOnly([{ type: 'url', url: 'https://evil.com/admin' }]);
    it.each([
        'https://evil.com/admin',
        'http://EVIL.com:8443/ADMIN/x',     // 스킴·포트·대소문자 무시
        'https://evil.com/%61dmin',         // 퍼센트 인코딩
        'https://evil.com/x/../admin/',     // 점 경로 + 끝 /
        'https://evil.com//admin',          // 연속 /
        'https://evil.com./admin',          // 끝 . 호스트
        'https://u:p@evil.com/admin?q=1',
    ])('차단: %s', (url) => {
        expect(allowed(remote(url), rules)).toBe(false);
    });
    it.each(['https://evil.com/administrator', 'https://evil.com/', 'https://good.com/admin'])('통과: %s', (url) => {
        expect(allowed(remote(url), rules)).toBe(true);
    });
});

describe('command 규칙 — allow 정확', () => {
    const rules = allowOnly([{ type: 'command', command: 'npx', package: '@modelcontextprotocol/*' }]);
    it.each([
        ['npx -y @modelcontextprotocol/server-filesystem@1.0.0 /data', true],
        ['npx @ModelContextProtocol/server-memory', true],
        ['npx @modelcontextprotocol-evil/x', false],     // 스코프 접두 속임
        ['npx evil-pkg', false],
        ['/tmp/x/npx @modelcontextprotocol/server-memory', false], // 경로가 붙은 실행 파일
        ['pnpm dlx @modelcontextprotocol/server-memory', false],   // 다른 실행 파일
        ['sh -c npx', false],
        ['node server.js', false],
    ])('%s → %s', (line, ok) => {
        expect(allowed(stdio(line), rules)).toBe(ok);
    });
    it('실행기가 받는 패키지는 전부 허용돼야 한다(-p 여러 개·--with 우회 차단)', () => {
        expect(allowed(stdio('npx -p @modelcontextprotocol/server-memory -p evil-pkg run'), rules)).toBe(false);
        expect(allowed(stdio('npx --package=@modelcontextprotocol/a --package=@modelcontextprotocol/b run'), rules)).toBe(true);
        const py = allowOnly([{ type: 'command', command: 'uvx', package: 'mcp-server-fetch' }]);
        expect(allowed(stdio('uvx mcp-server-fetch'), py)).toBe(true);
        expect(allowed(stdio('uvx --with evil mcp-server-fetch'), py)).toBe(false);
        expect(allowed(stdio('uvx --with=mcp-server-fetch,evil mcp-server-fetch'), py)).toBe(false);
    });
    it('버전을 적은 규칙은 같은 고정 버전만', () => {
        const pinned = allowOnly([{ type: 'command', command: 'npx', package: '@a/b@1.2.3' }]);
        expect(allowed(stdio('npx @a/b@1.2.3'), pinned)).toBe(true);
        expect(allowed(stdio('npx @a/b'), pinned)).toBe(false);
        expect(allowed(stdio('npx @a/b@latest'), pinned)).toBe(false);
        expect(allowed(stdio('npx @a/b@1.2.4'), pinned)).toBe(false);
    });
    it('package 없는 규칙 = 그 실행 파일 전부, docker 이미지 규칙', () => {
        expect(allowed(stdio('npx anything'), allowOnly([{ type: 'command', command: 'npx' }]))).toBe(true);
        const img = allowOnly([{ type: 'command', command: 'docker', package: 'ghcr.io/org/*' }]);
        expect(allowed(stdio('docker run -i --rm ghcr.io/Org/server:1'), img)).toBe(true);
        expect(allowed(stdio('docker run -i --rm ghcr.io/other/server:1'), img)).toBe(false);
    });
});

describe('command 규칙 — deny 넓게(우회 차단)', () => {
    const rules = denyOnly([{ type: 'command', command: 'npx', package: 'evil-pkg' }]);
    it.each([
        'npx evil-pkg',
        'npx -y evil-pkg@9.9.9',
        'npx EVIL-PKG',
        'npm exec evil-pkg',
        'pnpm dlx evil-pkg',
        'bunx evil-pkg',
        '/usr/local/bin/npx evil-pkg',
        'npx.cmd evil-pkg',
        'env A=1 npx evil-pkg',
        'npx --some-unknown-flag value evil-pkg',
        'npx -p evil-pkg run-it',
        'npx good-pkg --with evil-pkg',
    ])('차단: %s', (line) => {
        expect(allowed(stdio(line), rules)).toBe(false);
    });
    it.each([
        ['sh', ['-c', 'npx evil-pkg']],
        ['bash', ['-lc', 'echo hi && npx -y evil-pkg']],
        ['sh', ['-c', 'echo "$(npx evil-pkg)"']],
        ['cmd', ['/c', 'npx', 'evil-pkg']],
        ['bash', ['-c', "sh -c 'npx evil-pkg'"]],
        ['env', ['-S', 'npx evil-pkg']],
        ['nohup', ['npx', 'evil-pkg']],
        ['timeout', ['30', 'npx', 'evil-pkg']],
        ['sh', ['-c', 'exec npx evil-pkg']],
        ['docker', ['run', 'node:22', 'npx', 'evil-pkg']],
    ])('셸 감싸기 차단: %s %j', (command, args) => {
        expect(allowed(stdioArgs(command, args), rules)).toBe(false);
    });
    it.each(['npx good-pkg', 'npx evil-pkg-two', 'node evil-pkg'])('통과: %s', (line) => {
        expect(allowed(stdio(line), rules)).toBe(true);
    });
    it('버전을 적은 deny 는 같은 버전 + 떠다니는(미고정) 후보를 막는다', () => {
        const v = denyOnly([{ type: 'command', command: 'npx', package: 'pkg@1.0.0' }]);
        expect(allowed(stdio('npx pkg@1.0.0'), v)).toBe(false);
        expect(allowed(stdio('npx pkg'), v)).toBe(false);
        expect(allowed(stdio('npx pkg@latest'), v)).toBe(false);
        expect(allowed(stdio('npx pkg@2.0.0'), v)).toBe(true);
    });
    it('package 없는 deny 는 같은 계열 실행기 전부(npx 차단 → pnpm dlx·npm exec)', () => {
        const all = denyOnly([{ type: 'command', command: 'npx' }]);
        expect(allowed(stdio('pnpm dlx anything'), all)).toBe(false);
        expect(allowed(stdio('npm exec anything'), all)).toBe(false);
        expect(allowed(stdio('npm install anything'), all)).toBe(true);
        expect(allowed(stdio('uvx anything'), all)).toBe(true);
    });
    it('python·컨테이너 계열', () => {
        const py = denyOnly([{ type: 'command', command: 'uvx', package: 'Bad_Pkg' }]);
        expect(allowed(stdio('uvx bad-pkg==2'), py)).toBe(false);
        expect(allowed(stdio('pipx run bad.pkg'), py)).toBe(false);
        expect(allowed(stdio('uv tool run --from bad_pkg tool'), py)).toBe(false);
        const img = denyOnly([{ type: 'command', command: 'docker', package: 'evil/img' }]);
        expect(allowed(stdio('podman run docker.io/evil/img:1'), img)).toBe(false);
        expect(allowed(stdio('docker run --rm -e X=1 index.docker.io/evil/img'), img)).toBe(false);
        expect(allowed(stdio('docker container run evil/img@sha256:abc'), img)).toBe(false);
        expect(allowed(stdio('docker run good/img'), img)).toBe(true);
    });
});

describe('evaluateMcpServer — 층·deny 우선·fail-closed', () => {
    const fs = stdio('npx @modelcontextprotocol/server-filesystem');
    it('층 없음 = 제한 없음(식별 불가도 통과)', () => {
        expect(allowed(fs, [])).toBe(true);
        expect(allowed({ transport: 'stdio', command: '' }, [])).toBe(true);
    });
    it('allow 미설정 = 제한 없음, [] = 전부 차단', () => {
        expect(allowed(fs, [layer({ deny: [] })])).toBe(true);
        expect(evaluateMcpServer({ server: describeMcpServer(fs), layers: [layer({ allow: [] })] })).toMatchObject({ allowed: false, reason: 'NOT_ALLOWED', scope: 'global' });
    });
    it('deny 가 allow 보다 먼저', () => {
        const v = evaluateMcpServer({
            server: describeMcpServer(fs),
            layers: [layer({ allow: [{ type: 'command', command: 'npx' }], deny: [{ type: 'command', command: 'npx', package: '@modelcontextprotocol/*' }] })],
        });
        expect(v).toMatchObject({ allowed: false, reason: 'DENIED', rule: { type: 'command', command: 'npx' } });
    });
    it('allow 는 층마다 — 조직 층이 더 좁히면 양쪽 다 맞아야', () => {
        const layers = [
            layer({ allow: [{ type: 'command', command: 'npx' }] }),
            layer({ allow: [{ type: 'command', command: 'npx', package: '@a/*' }] }, 'organization'),
        ];
        expect(allowed(stdio('npx @a/x'), layers)).toBe(true);
        expect(evaluateMcpServer({ server: describeMcpServer(stdio('npx @b/x')), layers })).toMatchObject({ allowed: false, reason: 'NOT_ALLOWED', scope: 'organization' });
    });
    it('깨진 층 = 전부 차단(POLICY_INVALID)', () => {
        const broken = parseExtensionMcpServerPolicy({ allow: [{ type: 'command' }] }, 'organization');
        expect(broken).toMatchObject({ allow: [], broken: true });
        expect(evaluateMcpServer({ server: describeMcpServer(fs), layers: [broken] })).toMatchObject({ allowed: false, reason: 'POLICY_INVALID' });
    });
    it('식별 불가 = 층이 있으면 거절(deny 만 있어도)', () => {
        const layers = denyOnly([{ type: 'url', url: 'https://evil.com' }]);
        expect(evaluateMcpServer({ server: describeMcpServer(remote('javascript:alert(1)')), layers })).toMatchObject({ allowed: false, reason: 'UNIDENTIFIED' });
        expect(evaluateMcpServer({ server: describeMcpServer(stdioArgs('npx evil', [])), layers })).toMatchObject({ allowed: false, reason: 'UNIDENTIFIED' });
    });
});

describe('스키마 검증 — 저장 거절', () => {
    it.each([
        ['{"allow":[{"type":"url","url":"ftp://x.com"}]}'],
        ['{"allow":[{"type":"url","url":"https://a.*.com"}]}'],
        ['{"allow":[{"type":"command","command":"npx -y"}]}'],
        ['{"allow":[{"type":"command","command":"npx","package":"@a/*/b"}]}'],
        ['{"allow":[{"type":"command","command":"npx","extra":1}]}'],
        ['{"allowed":[]}'],
        ['not json'],
    ])('%s', (raw) => {
        expect(extensionMcpServerPolicyProblems(raw).length).toBeGreaterThan(0);
    });
    it('올바른 값', () => {
        expect(extensionMcpServerPolicyProblems('{"allow":[{"type":"url","url":"https://*.example.com/mcp"},{"type":"command","command":"npx","package":"@scope/*"}],"deny":[]}')).toEqual([]);
    });
    it('조직 정책 행 — 깨진 값도 전부 차단 층으로 남는다', () => {
        expect(parseOrgPolicyRows([{ key: 'EXTENSION_MCP_SERVER_POLICY', value: { allow: 'x' } }]).extensionMcpServer).toMatchObject({ allow: [], broken: true, scope: 'organization' });
        expect(parseOrgPolicyRows([{ key: 'EXTENSION_MCP_SERVER_POLICY', value: { deny: [{ type: 'command', command: 'npx' }] } }]).extensionMcpServer)
            .toEqual({ deny: [{ type: 'command', command: 'npx' }], scope: 'organization' });
    });
});

describe('정책 해석 — 강제 플래그·fail-closed', () => {
    const deps = (over: Partial<ExtensionMcpServerPolicyDeps> = {}): ExtensionMcpServerPolicyDeps & { audit: jest.Mock; loadOrgLayer: jest.Mock } => ({
        loadOrgLayer: jest.fn(async () => undefined),
        audit: jest.fn(async () => undefined),
        ...over,
    }) as never;
    const enforce = (policy?: string) => {
        process.env.EXTENSION_MCP_SERVER_POLICY_ENFORCED = 'true';
        if (policy !== undefined) process.env.EXTENSION_MCP_SERVER_POLICY = policy;
        resetConfig();
    };

    it('강제 OFF = 게이트 없음, 정책을 읽지도 않는다', async () => {
        process.env.EXTENSION_MCP_SERVER_POLICY = '{"allow":[]}';
        resetConfig();
        const d = deps();
        expect(await loadExtensionMcpServerGate('u1', d)).toBeNull();
        await expect(assertMcpServerAllowed({ userId: 'u1', origin: 'catalog', server: () => { throw new Error('평가되면 안 된다'); } }, d)).resolves.toBeUndefined();
        expect(d.loadOrgLayer).not.toHaveBeenCalled();
    });
    it('force = 강제 OFF 여도 같은 판정(미리보기)', async () => {
        process.env.EXTENSION_MCP_SERVER_POLICY = '{"allow":[]}';
        resetConfig();
        const gate = await loadExtensionMcpServerGate('u1', deps(), { force: true });
        expect(gate!.evaluate(stdio('npx x'))).toMatchObject({ allowed: false, reason: 'NOT_ALLOWED' });
    });
    it('전역 JSON 깨짐 = 전부 차단', async () => {
        enforce('{not json');
        const gate = await loadExtensionMcpServerGate('u1', deps());
        expect(gate!.evaluate(stdio('npx x'))).toMatchObject({ allowed: false, reason: 'POLICY_INVALID' });
    });
    it('조직 조회 실패 + 적용 이력 없음 = 거절(POLICY_UNAVAILABLE)', async () => {
        enforce();
        const gate = await loadExtensionMcpServerGate('u1', deps({ loadOrgLayer: jest.fn(async () => { throw new Error('db down'); }) }));
        expect(gate!.evaluate(stdio('npx x'))).toMatchObject({ allowed: false, reason: 'POLICY_UNAVAILABLE' });
    });
    it('조직 조회 실패 + 적용 이력 있음 = 마지막 층 유지', async () => {
        enforce();
        const org = layer({ deny: [{ type: 'command', command: 'npx', package: 'bad' }] }, 'organization');
        await loadExtensionMcpServerGate('u1', deps({ loadOrgLayer: jest.fn(async () => org) }));
        const gate = await loadExtensionMcpServerGate('u1', deps({ loadOrgLayer: jest.fn(async () => { throw new Error('db down'); }) }));
        expect(gate!.evaluate(stdio('npx bad'))).toMatchObject({ allowed: false, reason: 'DENIED', scope: 'organization' });
        expect(gate!.evaluate(stdio('npx good')).allowed).toBe(true);
    });
    it('assert — 거절은 403 + 감사(식별 문자열만)', async () => {
        enforce('{"deny":[{"type":"url","url":"https://evil.com"}]}');
        const d = deps();
        const err = await assertMcpServerAllowed({ userId: 'u1', origin: 'git-ingest', server: { name: 's', ...remote('https://evil.com/mcp?token=SECRET') } }, d).catch((e) => e);
        expect(err).toBeInstanceOf(ExtensionMcpServerBlockedError);
        expect(err.statusCode).toBe(403);
        expect(err.message).toMatch(/^EXTENSION_MCP_SERVER_BLOCKED: /);
        expect(err.message).not.toContain('SECRET');
        expect(d.audit).toHaveBeenCalledWith('u1', 'git-ingest', expect.objectContaining({ reason: 'DENIED', server: 'https://evil.com/mcp', name: 's' }));
    });
    it('감사 실패는 거절을 바꾸지 않는다', async () => {
        enforce('{"allow":[]}');
        await expect(assertMcpServerAllowed({ origin: 'catalog', server: stdio('npx x') }, deps({ audit: jest.fn(async () => { throw new Error('x'); }) })))
            .rejects.toBeInstanceOf(ExtensionMcpServerBlockedError);
    });
});
