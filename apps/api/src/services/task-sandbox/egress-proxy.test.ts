import { buildEgressProxyRunArgs, ensureEgressProxy, isProxyListening } from './egress-proxy';
import { getTaskSandboxConfig } from '../../config/task-sandbox';

describe('buildEgressProxyRunArgs', () => {
    const cfg = { ...getTaskSandboxConfig(), egressAllowlist: ['example.com', 'github.com'], egressAllowedPorts: [80, 443] };

    it('허용 도메인과 허용 포트를 프록시 컨테이너에 넘긴다', () => {
        const j = buildEgressProxyRunArgs(cfg).join(' ');
        expect(j).toContain('-e EGRESS_ALLOWLIST=example.com,github.com');
        expect(j).toContain('-e EGRESS_ALLOWED_PORTS=80,443');
    });

    it('internal 망에 권한을 줄여 띄우고 이미지가 마지막 인자다', () => {
        const r = buildEgressProxyRunArgs(cfg);
        expect(r.slice(0, 4)).toEqual(['run', '-d', '--name', cfg.egressProxyContainer]);
        expect(r.join(' ')).toContain(`--network ${cfg.egressNetwork}`);
        expect(r.join(' ')).toContain('--cap-drop ALL');
        expect(r[r.length - 1]).toBe(cfg.egressProxyImage);
    });

    it('허용 목록이 비고 public 모드면 EGRESS_ALLOWLIST_MODE=public 을 넘긴다', () => {
        const j = buildEgressProxyRunArgs({ ...cfg, egressAllowlist: [], egressPublicWhenEmpty: true }).join(' ');
        expect(j).toContain('-e EGRESS_ALLOWLIST_MODE=public');
    });

    it('허용 목록이 비어도 egressPublicWhenEmpty=false 면 모드를 넘기지 않는다(전부 거부)', () => {
        const j = buildEgressProxyRunArgs({ ...cfg, egressAllowlist: [], egressPublicWhenEmpty: false }).join(' ');
        expect(j).not.toContain('EGRESS_ALLOWLIST_MODE');
    });
});

describe('egressProxyEnabled 기본값(W3 S6)', () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const saved = process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED;
    afterEach(() => {
        process.env.NODE_ENV = savedNodeEnv;
        if (saved === undefined) delete process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED;
        else process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED = saved;
    });

    it('운영에서 미설정이면 켜지고, false 를 명시하면 꺼진다', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED;
        expect(getTaskSandboxConfig().egressProxyEnabled).toBe(true);
        process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED = 'false';
        expect(getTaskSandboxConfig().egressProxyEnabled).toBe(false);
    });

    it('dev/test 는 미설정이면 꺼진 채다', () => {
        process.env.NODE_ENV = 'test';
        delete process.env.TASK_SANDBOX_EGRESS_PROXY_ENABLED;
        expect(getTaskSandboxConfig().egressProxyEnabled).toBe(false);
    });
});

describe('egressAllowedPorts 설정', () => {
    const saved = process.env.TASK_SANDBOX_EGRESS_ALLOWED_PORTS;
    afterEach(() => {
        if (saved === undefined) delete process.env.TASK_SANDBOX_EGRESS_ALLOWED_PORTS;
        else process.env.TASK_SANDBOX_EGRESS_ALLOWED_PORTS = saved;
    });

    it('기본은 80·443', () => {
        delete process.env.TASK_SANDBOX_EGRESS_ALLOWED_PORTS;
        expect(getTaskSandboxConfig().egressAllowedPorts).toEqual([80, 443]);
    });

    it('환경변수로 바꾸고 숫자가 아닌 값은 버린다', () => {
        process.env.TASK_SANDBOX_EGRESS_ALLOWED_PORTS = '443, 8443, abc';
        expect(getTaskSandboxConfig().egressAllowedPorts).toEqual([443, 8443]);
    });
});

describe('isProxyListening (사용자 MCP 서버 실행 격리 보강, 2026-11-08 점검)', () => {
    it('기동 로그에 해당 포트 listening 줄이 있으면 true', () => {
        expect(isProxyListening('[egress-proxy] listening :8888 allowlist=[(empty) mode=public] ports=[80,443]', 8888)).toBe(true);
        expect(isProxyListening('noise\n[egress-proxy] listening :8888 allowlist=[a.com] ports=[443]\n', 8888)).toBe(true);
    });

    it('다른 포트·빈 로그·접두 포트는 false', () => {
        expect(isProxyListening('[egress-proxy] listening :9999 allowlist=[]', 8888)).toBe(false);
        expect(isProxyListening('', 8888)).toBe(false);
        expect(isProxyListening('[egress-proxy] listening :88881 allowlist=[]', 8888)).toBe(false);
    });
});

describe('egressReadyTimeoutMs 설정', () => {
    const saved = process.env.TASK_SANDBOX_EGRESS_READY_TIMEOUT_MS;
    afterEach(() => {
        if (saved === undefined) delete process.env.TASK_SANDBOX_EGRESS_READY_TIMEOUT_MS;
        else process.env.TASK_SANDBOX_EGRESS_READY_TIMEOUT_MS = saved;
    });

    it('기본 10000, 환경변수로 바꾼다', () => {
        delete process.env.TASK_SANDBOX_EGRESS_READY_TIMEOUT_MS;
        expect(getTaskSandboxConfig().egressReadyTimeoutMs).toBe(10_000);
        process.env.TASK_SANDBOX_EGRESS_READY_TIMEOUT_MS = '2500';
        expect(getTaskSandboxConfig().egressReadyTimeoutMs).toBe(2500);
    });
});

describe('ensureEgressProxy 준비 대기 (리뷰 Minor 반영, 2026-11-08 점검)', () => {
    type Res = { code: number; stdout: string; stderr: string };
    const ok = (stdout = ''): Res => ({ code: 0, stdout, stderr: '' });
    const base = { ...getTaskSandboxConfig(), dockerPath: 'docker', egressReadyTimeoutMs: 2000 };
    const listening = `[egress-proxy] listening :${base.egressProxyPort} allowlist=[] ports=[443]`;
    /** docker inspect 의 StartedAt 모양(나노초 9자리) — msAgo 전 시각. */
    const startedAt = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().replace(/Z$/, '456789Z');
    const denyLogs = Array.from({ length: 50 }, () => 'DENY a.example:443 (blocked)').join('\n');

    /** 명령 종류별 응답 큐 — 마지막 응답은 계속 반복한다. 호출 기록을 남긴다. */
    function fakeExec(queues: Record<string, Res[]>) {
        const calls: string[][] = [];
        // 준비 대기의 inspect(Running + StartedAt)는 ensure 의 Running 전용 inspect 와 따로 센다.
        const kindOf = (a: string[]) => (a[0] === 'inspect' && /StartedAt/.test(a[2] ?? '') ? 'inspect:started'
            : a[0] === 'network' || a[0] === 'run' && a[1] === '-d' ? `${a[0]}:${a[1]}` : a[0]);
        const exec = async (_d: string, args: string[]): Promise<Res> => {
            calls.push(args);
            const q = queues[kindOf(args)];
            if (!q || q.length === 0) return ok();
            return q.length > 1 ? q.shift()! : q[0];
        };
        const count = (kind: string) => calls.filter((a) => kindOf(a) === kind).length;
        return { exec, calls, count };
    }

    it('(a) 이미 떠 있고 listening 이면 새로 띄우지 않고 logs 1회로 URL 을 돌려준다', async () => {
        const f = fakeExec({ 'network:inspect': [ok('[]')], inspect: [ok('true')], logs: [ok(listening)] });
        await expect(ensureEgressProxy(base, f.exec)).resolves.toBe(`http://${base.egressProxyContainer}:${base.egressProxyPort}`);
        expect(f.count('run:-d')).toBe(0);
        expect(f.count('logs')).toBe(1);
    });

    it('(b) 떠 있지만 아직 listen 전이면 listening 이 보일 때까지 기다린다', async () => {
        const f = fakeExec({ 'network:inspect': [ok('[]')], inspect: [ok('true')], 'inspect:started': [ok(`true ${startedAt(0)}`)], logs: [ok(''), ok(listening)] });
        await expect(ensureEgressProxy(base, f.exec)).resolves.toContain(`:${base.egressProxyPort}`);
        expect(f.count('run:-d')).toBe(0);
        expect(f.count('logs')).toBe(2);
    });

    it('(c) 새로 띄운 컨테이너가 실행 중이 아니면 시간 초과를 기다리지 않고 바로 실패한다', async () => {
        const f = fakeExec({ 'network:inspect': [ok('[]')], inspect: [ok('false')], 'inspect:started': [ok(`false ${startedAt(0)}`)], logs: [ok('')] });
        const t0 = Date.now();
        await expect(ensureEgressProxy(base, f.exec)).rejects.toThrow('실행 중이 아닙니다');
        expect(Date.now() - t0).toBeLessThan(1000);
        expect(f.count('run:-d')).toBe(1);
        expect(f.count('logs')).toBe(1);
    });

    it('(d) 실행 중이지만 끝내 listen 하지 않으면 시간 초과 오류', async () => {
        const f = fakeExec({ 'network:inspect': [ok('[]')], inspect: [ok('true')], 'inspect:started': [ok(`true ${startedAt(0)}`)], logs: [ok('')] });
        await expect(ensureEgressProxy({ ...base, egressReadyTimeoutMs: 300 }, f.exec)).rejects.toThrow('준비되지 않았습니다(300ms)');
        expect(f.count('logs')).toBeGreaterThanOrEqual(2);
    });

    it('(e) 오래 떠 있던 프록시는 로그가 밀려 listening 줄이 없어도 기다리지 않고 URL 을 돌려준다', async () => {
        const f = fakeExec({ 'network:inspect': [ok('[]')], inspect: [ok('true')], 'inspect:started': [ok(`true ${startedAt(60_000)}`)], logs: [ok(denyLogs)] });
        const t0 = Date.now();
        await expect(ensureEgressProxy(base, f.exec)).resolves.toBe(`http://${base.egressProxyContainer}:${base.egressProxyPort}`);
        expect(Date.now() - t0).toBeLessThan(1000);
        expect(f.count('run:-d')).toBe(0);
        expect(f.count('logs')).toBe(1);
    });

    it('(f) 방금 기동한 컨테이너가 listen 하지 않으면 그대로 시간 초과 오류', async () => {
        const f = fakeExec({ 'network:inspect': [ok('[]')], inspect: [ok('true')], 'inspect:started': [ok(`true ${startedAt(100)}`)], logs: [ok(denyLogs)] });
        await expect(ensureEgressProxy({ ...base, egressReadyTimeoutMs: 300 }, f.exec)).rejects.toThrow('준비되지 않았습니다(300ms)');
    });

    it('(g) 기동 시각을 읽지 못하면 방금 기동한 것으로 보고 시간 초과 오류', async () => {
        const f = fakeExec({ 'network:inspect': [ok('[]')], inspect: [ok('true')], 'inspect:started': [ok('true not-a-time')], logs: [ok(denyLogs)] });
        await expect(ensureEgressProxy({ ...base, egressReadyTimeoutMs: 300 }, f.exec)).rejects.toThrow('준비되지 않았습니다(300ms)');
    });
});
