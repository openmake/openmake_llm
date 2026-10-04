import {
    browserSessionContainerName, buildBrowserSessionRunArgs, buildBrowserSessionExecArgs,
    browserSessionInputSchema, browserSessionStartSchema, BROWSER_SESSION_SCRIPT, lastBrowserUrl, isBlockedSessionUrl,
} from './browser-session';
import { getTaskSandboxConfig, BROWSER_SESSION } from '../../config/task-sandbox';

describe('browser-session (사용자가 넘겨받는 브라우저)', () => {
    const cfg = { ...getTaskSandboxConfig(), egressProxyEnabled: false, browserNetwork: 'bridge' };

    it('컨테이너 이름은 작업 컨테이너(omk-task-)와 겹치지 않고 id 를 안전화한다', () => {
        expect(browserSessionContainerName('abc/..;rm')).toBe('omk-browser-abc_.._rm');
        expect(browserSessionContainerName('t1').startsWith('omk-task-')).toBe(false);
    });

    describe('buildBrowserSessionRunArgs', () => {
        const args = buildBrowserSessionRunArgs('omk-browser-t1', '/ws/t1', cfg, {});
        it('분리 실행 + 종료 시 자동 삭제 + 이름', () => {
            expect(args.slice(0, 6)).toEqual(['run', '-d', '--rm', '--init', '--name', 'omk-browser-t1']);
        });
        it('에이전트 브라우저와 같은 격리 플래그를 쓴다', () => {
            const s = args.join(' ');
            expect(s).toContain('--cap-drop ALL');
            expect(s).toContain('--security-opt no-new-privileges');
            expect(s).toContain('--read-only');
            expect(s).toContain(`--user ${cfg.user}`);
            expect(s).toContain('--network bridge');
            expect(s).toContain('-v /ws/t1:/workspace:rw');
        });
        it('호스트로 포트를 열지 않는다(명령은 docker exec 로만 전달)', () => {
            expect(args).not.toContain('-p');
            expect(args).not.toContain('--publish');
        });
        it('이미지 안의 node 로 작업 공간의 세션 스크립트를 실행한다', () => {
            expect(args.slice(-3)).toEqual([cfg.image, 'node', `/workspace/${BROWSER_SESSION.SCRIPT_FILE}`]);
        });
        it('유휴 상한·상태 파일을 환경변수로 넘긴다', () => {
            expect(args).toContain(`OMK_IDLE_MS=${BROWSER_SESSION.IDLE_MS}`);
            expect(args).toContain(`OMK_STATE_FILE=${BROWSER_SESSION.STATE_FILE}`);
        });
        it('egress 프록시가 켜져 있으면 internal 망 + 프록시를 쓴다', () => {
            const a = buildBrowserSessionRunArgs('n', '/ws/t1', cfg, { proxyUrl: 'http://omk-egress-proxy:8888' });
            expect(a.join(' ')).toContain(`--network ${cfg.egressNetwork}`);
            expect(a).toContain('BROWSER_PROXY=http://omk-egress-proxy:8888');
        });
        it('시작 주소는 환경변수로만 넘긴다(명령 인자로 해석되지 않는다)', () => {
            const a = buildBrowserSessionRunArgs('n', '/ws/t1', cfg, { startUrl: 'https://example.com/a?b=1' });
            expect(a).toContain('OMK_START_URL=https://example.com/a?b=1');
        });
    });

    describe('목적지 검사(에이전트 브라우저와 같은 기준)', () => {
        const saved = { ...process.env };
        afterEach(() => { process.env = { ...saved }; });

        it('프록시가 없으면 컨테이너 안 검사 설정(허용 예외)을 넘긴다', () => {
            process.env.SSRF_ALLOWED_HOSTS = 'intra.example:8080';
            delete process.env.TASK_SANDBOX_BROWSER_URL_GUARD;
            expect(buildBrowserSessionRunArgs('n', '/ws/t1', cfg, {})).toContain('BROWSER_GUARD_ALLOWED_HOSTS=intra.example:8080');
        });
        it('검사를 끈 배포에서는 끄라고 넘긴다', () => {
            process.env.TASK_SANDBOX_BROWSER_URL_GUARD = 'false';
            expect(buildBrowserSessionRunArgs('n', '/ws/t1', cfg, {})).toContain('BROWSER_DEST_GUARD=off');
        });
        it('egress 프록시를 쓰면 넘기지 않는다(프록시가 검사한다)', () => {
            process.env.SSRF_ALLOWED_HOSTS = 'intra.example:8080';
            const a = buildBrowserSessionRunArgs('n', '/ws/t1', cfg, { proxyUrl: 'http://omk-egress-proxy:8888' });
            expect(a.join(' ')).not.toContain('BROWSER_GUARD_ALLOWED_HOSTS');
        });
        it('세션 스크립트는 이미지에 검사 프록시가 있으면 띄워 루프백까지 지나게 한다', () => {
            expect(BROWSER_SESSION_SCRIPT).toContain("'/opt/browser/guard-proxy.mjs'");
            expect(BROWSER_SESSION_SCRIPT).toContain("bypass: '<-loopback>'");
            expect(BROWSER_SESSION_SCRIPT).toContain("BROWSER_DEST_GUARD !== 'off'");
        });
        it('isBlockedSessionUrl — 검사가 막는 주소만 true', async () => {
            const validate = async (u: string) => { if (u.includes('169.254.')) throw new Error('blocked'); };
            expect(await isBlockedSessionUrl('http://169.254.169.254/', validate)).toBe(true);
            expect(await isBlockedSessionUrl('https://example.com/', validate)).toBe(false);
        });
        it('isBlockedSessionUrl — 실제 가드로 루프백·메타데이터 주소를 막는다(이름 풀이 없는 IP)', async () => {
            expect(await isBlockedSessionUrl('http://127.0.0.1:52418/')).toBe(true);
            expect(await isBlockedSessionUrl('http://169.254.169.254/latest/meta-data/')).toBe(true);
        });
    });

    it('buildBrowserSessionExecArgs — 컨테이너 안 루프백으로만 명령을 보낸다(본문은 stdin)', () => {
        const a = buildBrowserSessionExecArgs('omk-browser-t1');
        expect(a.slice(0, 4)).toEqual(['exec', '-i', 'omk-browser-t1', 'curl']);
        expect(a).toContain('@-');
        expect(a[a.length - 1]).toBe(`http://127.0.0.1:${BROWSER_SESSION.PORT}/cmd`);
    });

    describe('browserSessionInputSchema', () => {
        const ok = (v: unknown) => browserSessionInputSchema.safeParse(v).success;
        it('허용 입력', () => {
            expect(ok({ op: 'click', x: 10, y: 20 })).toBe(true);
            expect(ok({ op: 'type', text: '안녕' })).toBe(true);
            expect(ok({ op: 'key', key: 'Enter' })).toBe(true);
            expect(ok({ op: 'key', key: 'Control+a' })).toBe(true);
            expect(ok({ op: 'scroll', dy: -300 })).toBe(true);
            expect(ok({ op: 'goto', url: 'https://example.com/login' })).toBe(true);
            expect(ok({ op: 'back' })).toBe(true);
        });
        it('화면 밖 좌표·알 수 없는 명령은 거절', () => {
            expect(ok({ op: 'click', x: -1, y: 0 })).toBe(false);
            expect(ok({ op: 'click', x: BROWSER_SESSION.VIEWPORT.width + 1, y: 0 })).toBe(false);
            expect(ok({ op: 'eval', code: '1' })).toBe(false);
            expect(ok({ op: 'close' })).toBe(false); // 돌려주기는 전용 라우트로만
            expect(ok({ op: 'shot' })).toBe(false);
        });
        it('http(s) 가 아닌 주소는 거절', () => {
            expect(ok({ op: 'goto', url: 'file:///etc/passwd' })).toBe(false);
            expect(ok({ op: 'goto', url: 'javascript:alert(1)' })).toBe(false);
            expect(ok({ op: 'goto', url: 'chrome://settings' })).toBe(false);
        });
        it('너무 긴 입력·이상한 키 이름은 거절', () => {
            expect(ok({ op: 'type', text: 'a'.repeat(BROWSER_SESSION.TEXT_MAX + 1) })).toBe(false);
            expect(ok({ op: 'key', key: 'Enter; rm -rf' })).toBe(false);
        });
    });

    it('lastBrowserUrl — 마지막 browser 호출의 마지막 goto, http(s) 만', () => {
        expect(lastBrowserUrl([])).toBeUndefined();
        expect(lastBrowserUrl([{ tool_name: 'browser', tool_args: { actions: [{ type: 'goto', url: 'file:///etc/passwd' }] } }])).toBeUndefined();
        expect(lastBrowserUrl([
            { tool_name: 'browser', tool_args: { actions: [{ type: 'goto', url: 'https://a.example' }, { type: 'goto', url: 'https://b.example' }] } },
            { tool_name: 'browser', tool_args: { actions: 'bad' } },
            { tool_name: 'bash', tool_args: null },
        ])).toBe('https://b.example');
    });

    it('browserSessionStartSchema — 시작 주소는 선택, 있으면 http(s)', () => {
        expect(browserSessionStartSchema.safeParse({}).success).toBe(true);
        expect(browserSessionStartSchema.safeParse({ url: 'https://example.com' }).success).toBe(true);
        expect(browserSessionStartSchema.safeParse({ url: 'file:///x' }).success).toBe(false);
    });

    it('넘겨받아 남긴 상태 파일이 있으면 지속 설정이 꺼져 있어도 에이전트가 이어받는다', async () => {
        const { mkdtemp, mkdir, writeFile, rm } = await import('fs/promises');
        const { tmpdir } = await import('os');
        const { join } = await import('path');
        const { TaskSandbox } = await import('./sandbox');
        const root = await mkdtemp(join(tmpdir(), 'omk-bs-state-'));
        const sb = new TaskSandbox('t1', { ...cfg, workspaceRoot: root, browserPersist: false });
        expect(sb.browserStatePath).toBeNull();
        await mkdir(sb.hostWorkdir, { recursive: true });
        await writeFile(join(sb.hostWorkdir, BROWSER_SESSION.STATE_FILE), '{}');
        expect(sb.browserStatePath).toBe(BROWSER_SESSION.STATE_FILE);
        await rm(root, { recursive: true, force: true });
    });

    it('작업 공간을 보존하는 정리(승인 대기 주차 등)는 넘겨받은 세션을 내리지 않는다 — 지울 때만 내린다', async () => {
        const { mkdtemp, writeFile, readFile, chmod, rm } = await import('fs/promises');
        const { tmpdir } = await import('os');
        const { join } = await import('path');
        const { TaskSandbox } = await import('./sandbox');
        const root = await mkdtemp(join(tmpdir(), 'omk-bs-clean-'));
        // docker 대역 — 받은 인자를 기록하고, inspect 에는 "돌고 있다"고 답한다
        const fake = join(root, 'docker.sh');
        const log = join(root, 'calls.log');
        await writeFile(fake, `#!/bin/sh\necho "$@" >> "${log}"\n[ "$1" = inspect ] && echo true\nexit 0\n`);
        await chmod(fake, 0o755);
        const sb = new TaskSandbox('t1', { ...cfg, workspaceRoot: join(root, 'ws'), dockerPath: fake });
        await sb.cleanup(false);
        expect(await readFile(log, 'utf8')).not.toContain('omk-browser-t1');
        await sb.cleanup(true);
        expect(await readFile(log, 'utf8')).toContain('omk-browser-t1');
        await rm(root, { recursive: true, force: true });
    }, 30_000);

    it('세션 스크립트는 문법이 맞는 ES 모듈이다', async () => {
        const { mkdtemp, writeFile, rm } = await import('fs/promises');
        const { tmpdir } = await import('os');
        const { join } = await import('path');
        const { spawnSync } = await import('child_process');
        const dir = await mkdtemp(join(tmpdir(), 'omk-bs-'));
        const f = join(dir, 's.mjs');
        await writeFile(f, BROWSER_SESSION_SCRIPT);
        const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        await rm(dir, { recursive: true, force: true });
        expect(r.stderr).toBe('');
        expect(r.status).toBe(0);
    });
});
