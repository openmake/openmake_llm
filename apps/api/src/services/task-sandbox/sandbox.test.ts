import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { buildRunArgs, buildBrowserRunArgs, buildWriteArgs, buildKillExecArgs, safeResolveWorkspacePath, safeRealWorkspacePath, sanitizeId, dirSizeBytes, listWorkspaceFilesAt, TaskSandbox } from './sandbox';
import { getTaskSandboxConfig, resolveWriteViaContainer } from '../../config/task-sandbox';

describe('task-sandbox pure functions', () => {
    const cfg = getTaskSandboxConfig();

    describe('sanitizeId', () => {
        it('영숫자/._- 외 문자를 _ 로 치환', () => {
            expect(sanitizeId('task/../evil; rm -rf')).toBe('task_.._evil__rm_-rf');
        });
        it('빈 입력은 unknown', () => {
            expect(sanitizeId('!!!')).toBe('___'); // 비지 않으면 그대로 치환
            expect(sanitizeId('')).toBe('unknown');
        });
        it('64자 상한', () => {
            expect(sanitizeId('a'.repeat(100)).length).toBe(64);
        });
    });

    describe('safeResolveWorkspacePath', () => {
        const root = '/tmp/ws/task1';
        it('내부 경로 허용', () => {
            expect(safeResolveWorkspacePath(root, 'sub/file.txt')).toBe('/tmp/ws/task1/sub/file.txt');
            expect(safeResolveWorkspacePath(root, '.')).toBe('/tmp/ws/task1');
        });
        it('../ 탈출 차단', () => {
            expect(() => safeResolveWorkspacePath(root, '../etc/passwd')).toThrow('탈출 차단');
            expect(() => safeResolveWorkspacePath(root, '../../root/.ssh/id_rsa')).toThrow('탈출 차단');
        });
        it('절대경로 탈출 차단', () => {
            expect(() => safeResolveWorkspacePath(root, '/etc/passwd')).toThrow('탈출 차단');
        });
        it('prefix 유사 디렉토리 탈출 차단 (task1-evil)', () => {
            expect(() => safeResolveWorkspacePath(root, '../task1-evil/x')).toThrow('탈출 차단');
        });
        // 컨테이너 마운트 지점 표기 — 에이전트가 컨테이너 안에서 보는 실제 경로다(2026-08-03).
        // 종전에는 탈출로 차단돼 예약 리포트가 /workspace/data.json 쓰기에 반복 실패했다.
        it('컨테이너 절대경로(/workspace/...)는 같은 대상으로 해석', () => {
            expect(safeResolveWorkspacePath(root, '/workspace/data.json')).toBe('/tmp/ws/task1/data.json');
            expect(safeResolveWorkspacePath(root, '/workspace/sub/report.html')).toBe('/tmp/ws/task1/sub/report.html');
            expect(safeResolveWorkspacePath(root, '/workspace')).toBe('/tmp/ws/task1');
            expect(safeResolveWorkspacePath(root, '/workspace/')).toBe('/tmp/ws/task1');
        });
        it('정규화 후에도 탈출은 차단 — /workspace/../ 와 prefix 유사 경로', () => {
            expect(() => safeResolveWorkspacePath(root, '/workspace/../etc/passwd')).toThrow('탈출 차단');
            expect(() => safeResolveWorkspacePath(root, '/workspace-evil/x')).toThrow('탈출 차단');
        });
    });

    describe('safeRealWorkspacePath (심링크 탈출 차단 — 실제 FS)', () => {
        let base: string;   // 임시 루트
        let ws: string;     // workspace
        let outside: string; // workspace 밖 디렉토리 (탈출 대상)

        beforeAll(async () => {
            base = await mkdtemp(join(tmpdir(), 'omk-sbx-test-'));
            ws = join(base, 'ws');
            outside = join(base, 'outside');
            await mkdir(ws, { recursive: true });
            await mkdir(outside, { recursive: true });
            await writeFile(join(outside, 'secret.txt'), 'host-secret', 'utf8');
            await writeFile(join(ws, 'ok.txt'), 'inside', 'utf8');
            await mkdir(join(ws, 'inner'), { recursive: true });
            // 탈출 심링크: ws/leak → outside/secret.txt, ws/leakdir → outside
            await symlink(join(outside, 'secret.txt'), join(ws, 'leak'));
            await symlink(outside, join(ws, 'leakdir'));
            // 내부 심링크: ws/alias → ws/inner (workspace 안에서 안으로 — 허용)
            await symlink(join(ws, 'inner'), join(ws, 'alias'));
            // 대상이 없는(dangling) 심링크: realpath ENOENT 를 "미실존" 으로 넘기면 통과하던 갭
            await symlink(join(outside, 'not-yet.txt'), join(ws, 'dangling'));
        });
        afterAll(async () => {
            await rm(base, { recursive: true, force: true });
        });

        it('workspace 밖을 가리키는 파일 심링크 차단', async () => {
            await expect(safeRealWorkspacePath(ws, 'leak')).rejects.toThrow('symlink');
        });
        it('workspace 밖을 가리키는 디렉토리 심링크 경유 차단 (실존/미실존 꼬리 모두)', async () => {
            await expect(safeRealWorkspacePath(ws, 'leakdir/secret.txt')).rejects.toThrow('symlink');
            await expect(safeRealWorkspacePath(ws, 'leakdir/newfile.txt')).rejects.toThrow('symlink');
        });
        it('대상이 없는 심링크(dangling)는 차단 — 쓰기가 링크를 따라 밖에 파일을 만드는 경로', async () => {
            await expect(safeRealWorkspacePath(ws, 'dangling')).rejects.toThrow('symlink');
        });
        it('내부 → 내부 심링크는 허용 (대상 실경로 반환)', async () => {
            const p = await safeRealWorkspacePath(ws, 'alias/x.txt');
            expect(p.includes(`${sep}inner${sep}`)).toBe(true);
        });
        it('실존 내부 파일·미실존 내부 경로 허용', async () => {
            await expect(safeRealWorkspacePath(ws, 'ok.txt')).resolves.toBeTruthy();
            await expect(safeRealWorkspacePath(ws, 'newdir/new.txt')).resolves.toBeTruthy();
        });
        it('어휘적 탈출도 여전히 차단 (1차 가드 유지)', async () => {
            await expect(safeRealWorkspacePath(ws, '../outside/secret.txt')).rejects.toThrow('탈출 차단');
        });
    });

    describe('workspace 디스크 쿼터 (dirSizeBytes + writeFile 거절)', () => {
        let base: string;

        beforeAll(async () => {
            base = await mkdtemp(join(tmpdir(), 'omk-quota-test-'));
            await mkdir(join(base, 'sub'), { recursive: true });
            await writeFile(join(base, 'a.bin'), 'x'.repeat(100), 'utf8');
            await writeFile(join(base, 'sub', 'b.bin'), 'y'.repeat(50), 'utf8');
        });
        afterAll(async () => {
            await rm(base, { recursive: true, force: true });
        });

        it('dirSizeBytes 는 재귀 합산', async () => {
            expect(await dirSizeBytes(base)).toBe(150);
        });
        it('cap 도달 시 조기 중단 (cap 이상 판정용)', async () => {
            expect(await dirSizeBytes(base, 10)).toBeGreaterThanOrEqual(10);
        });
        it('writeFile 은 쿼터 초과 시 거절, 이내면 허용', async () => {
            // workspaceRoot=base 의 부모, taskId=base 의 디렉토리명 → hostWorkdir === base
            const parent = join(base, '..');
            const id = base.split(sep).pop() as string;
            const sb = new TaskSandbox(id, { ...cfg, workspaceRoot: parent, workspaceQuota: 200 });
            await expect(sb.writeFile('big.bin', 'z'.repeat(100))).rejects.toThrow('쿼터 초과'); // 150+100 > 200
            await expect(sb.writeFile('ok.bin', 'z'.repeat(10))).resolves.toBeUndefined();       // 150+10 ≤ 200
        });
    });

    describe('listWorkspaceFilesAt (숨김 파일/디렉토리 제외)', () => {
        let base: string;

        beforeAll(async () => {
            base = await mkdtemp(join(tmpdir(), 'omk-list-test-'));
            await mkdir(join(base, 'src'), { recursive: true });
            await mkdir(join(base, '.git', 'objects'), { recursive: true });
            await writeFile(join(base, 'src', 'a.ts'), 'x', 'utf8');
            await writeFile(join(base, 'report.md'), 'y', 'utf8');
            await writeFile(join(base, '.git', 'HEAD'), 'ref', 'utf8');
            await writeFile(join(base, '.git', 'objects', 'ab'), 'z', 'utf8');
            await writeFile(join(base, '.verify_0.py'), 'compile check', 'utf8'); // 코드검증 임시
            await writeFile(join(base, '.env'), 'SECRET=1', 'utf8'); // 기타 dotfile
        });
        afterAll(async () => {
            await rm(base, { recursive: true, force: true });
        });

        it('.git·.verify_*·기타 dotfile 은 산출물 목록에서 제외', async () => {
            const files = await listWorkspaceFilesAt(base);
            expect(files).toEqual(['report.md', join('src', 'a.ts')]);
        });
    });

    // workspace 는 호스트 디렉터리를 bind mount 한 것이다. macOS 의 Colima(virtiofs)는 컨테이너가 방금 본 파일을
    // 호스트가 덮어쓰면 약 1초 동안 예전 크기로 읽는다(2026-09-29 실측: 연속 20회 중 18회 오독). 컨테이너 안에서
    // 쓰면 컨테이너도 호스트도 곧바로 정확히 읽는다(같은 실측 20회 중 0회).
    describe('컨테이너 안에서 쓰기 (writeViaContainer)', () => {
        it('buildWriteArgs: 경로는 셸 문자열에 넣지 않고 위치 인자로 넘긴다', () => {
            const a = buildWriteArgs('omk-task-abc', '/workspace/src/a b;rm -rf $HOME.py');
            expect(a).toEqual(['exec', '-i', 'omk-task-abc', 'sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', '/workspace/src/a b;rm -rf $HOME.py']);
        });

        it('resolveWriteViaContainer: 전용 Colima 를 쓰는 호스트에서만 켜진다', () => {
            expect(resolveWriteViaContainer({ DOCKER_HOST: 'unix:///Users/u/.colima/openmake/docker.sock' })).toBe(true);
            expect(resolveWriteViaContainer({})).toBe(false);                                            // Linux·기존 설치본
            expect(resolveWriteViaContainer({ DOCKER_HOST: 'unix:///var/run/docker.sock' })).toBe(false);
            expect(resolveWriteViaContainer({ DOCKER_HOST: 'tcp://10.0.0.1:2375' })).toBe(false);
        });
        it('resolveWriteViaContainer: 환경변수로 직접 정하면 그 값이 이긴다', () => {
            expect(resolveWriteViaContainer({ TASK_SANDBOX_WRITE_VIA_CONTAINER: 'true' })).toBe(true);
            expect(resolveWriteViaContainer({ TASK_SANDBOX_WRITE_VIA_CONTAINER: 'false', DOCKER_HOST: 'unix:///Users/u/.colima/openmake/docker.sock' })).toBe(false);
        });

        /** docker 대역 — 받은 인자를 기록하고, `exec -i … sh <경로>` 는 stdin 을 workspace 의 그 경로에 쓴다. */
        async function fakeDocker(dir: string, opts: { execFails?: boolean } = {}): Promise<{ bin: string; log: string }> {
            const bin = join(dir, 'docker'); const log = join(dir, 'docker.log');
            await writeFile(bin, [
                '#!/bin/sh',
                `printf '%s\\n' "$*" >> '${log}'`,
                'case "$1" in',
                '  exec)',
                opts.execFails ? '    echo "container is not running" >&2; exit 1 ;;' : [
                    '    for last; do :; done',                       // 마지막 인자 = 컨테이너 경로
                    '    rel="${last#/workspace/}"',
                    '    mkdir -p "$(dirname "$FAKE_WS/$rel")" && cat > "$FAKE_WS/$rel" ;;',
                ].join('\n'),
                '  *) exit 0 ;;',
                'esac',
                '',
            ].join('\n'), 'utf8');
            await chmod(bin, 0o755);
            return { bin, log };
        }
        const readLog = (p: string) => readFile(p, 'utf8').catch(() => '');

        it('켜져 있으면 docker exec 로 쓴다 — 하위 디렉터리·바이너리 포함', async () => {
            const base = await mkdtemp(join(tmpdir(), 'omk-wvc-'));
            try {
                const { bin, log } = await fakeDocker(base);
                const sb = new TaskSandbox('t1', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: bin, writeViaContainer: true });
                process.env.FAKE_WS = sb.hostWorkdir;
                await sb.create();
                await sb.writeFile('src/a.py', 'print(1)\n');
                await sb.writeFile('/workspace/b.bin', Buffer.from([0, 255, 10, 13, 0]));   // 컨테이너 절대경로 표기도 같은 파일
                expect(await readFile(join(sb.hostWorkdir, 'src/a.py'), 'utf8')).toBe('print(1)\n');
                expect([...await readFile(join(sb.hostWorkdir, 'b.bin'))]).toEqual([0, 255, 10, 13, 0]);
                const l = await readLog(log);
                expect(l).toContain('exec -i omk-task-t1 sh -c');
                expect(l).toContain('/workspace/src/a.py');
                expect(l).toContain('/workspace/b.bin');
            } finally { delete process.env.FAKE_WS; await rm(base, { recursive: true, force: true }); }
        });

        it('꺼져 있으면(기본) 호스트에서 직접 쓴다 — docker exec 를 부르지 않는다', async () => {
            const base = await mkdtemp(join(tmpdir(), 'omk-wvc-'));
            try {
                const { bin, log } = await fakeDocker(base);
                const sb = new TaskSandbox('t2', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: bin, writeViaContainer: false });
                await sb.create();
                await sb.writeFile('a.txt', 'host');
                expect(await readFile(join(sb.hostWorkdir, 'a.txt'), 'utf8')).toBe('host');
                expect(await readLog(log)).not.toContain('exec -i');
            } finally { await rm(base, { recursive: true, force: true }); }
        });

        it('컨테이너를 만들기 전의 쓰기(입력 첨부)는 호스트에서 쓴다', async () => {
            const base = await mkdtemp(join(tmpdir(), 'omk-wvc-'));
            try {
                const { bin, log } = await fakeDocker(base);
                const sb = new TaskSandbox('t3', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: bin, writeViaContainer: true });
                await mkdir(sb.hostWorkdir, { recursive: true });
                await sb.writeFile('uploads/in.txt', 'attached');
                expect(await readFile(join(sb.hostWorkdir, 'uploads/in.txt'), 'utf8')).toBe('attached');
                expect(await readLog(log)).not.toContain('exec -i');
            } finally { await rm(base, { recursive: true, force: true }); }
        });

        it('docker exec 가 실패하면 호스트 쓰기로 넘어간다 — 도구 호출을 실패시키지 않는다', async () => {
            const base = await mkdtemp(join(tmpdir(), 'omk-wvc-'));
            try {
                const { bin } = await fakeDocker(base, { execFails: true });
                const sb = new TaskSandbox('t4', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: bin, writeViaContainer: true });
                await sb.create();
                await sb.writeFile('a.txt', 'fallback');
                expect(await readFile(join(sb.hostWorkdir, 'a.txt'), 'utf8')).toBe('fallback');
            } finally { await rm(base, { recursive: true, force: true }); }
        });

        it('큰 내용을 쓰는 중에 docker 가 먼저 끝나도(EPIPE) 프로세스가 죽지 않고 호스트 쓰기로 넘어간다', async () => {
            const base = await mkdtemp(join(tmpdir(), 'omk-wvc-'));
            try {
                const { bin } = await fakeDocker(base, { execFails: true });   // stdin 을 읽지 않고 끝난다
                const sb = new TaskSandbox('t6', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: bin, writeViaContainer: true });
                await sb.create();
                const big = 'x'.repeat(8 * 1024 * 1024);
                await sb.writeFile('big.txt', big);
                expect((await readFile(join(sb.hostWorkdir, 'big.txt'), 'utf8')).length).toBe(big.length);
            } finally { await rm(base, { recursive: true, force: true }); }
        });

        it('경로 탈출과 쿼터 검사는 그대로 먼저 한다', async () => {
            const base = await mkdtemp(join(tmpdir(), 'omk-wvc-'));
            try {
                const { bin, log } = await fakeDocker(base);
                const sb = new TaskSandbox('t5', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: bin, writeViaContainer: true, workspaceQuota: 10 });
                process.env.FAKE_WS = sb.hostWorkdir;
                await sb.create();
                await expect(sb.writeFile('../escape.txt', 'x')).rejects.toThrow('탈출');
                await expect(sb.writeFile('big.txt', 'x'.repeat(50))).rejects.toThrow('쿼터 초과');
                expect(await readLog(log)).not.toContain('exec -i');
            } finally { delete process.env.FAKE_WS; await rm(base, { recursive: true, force: true }); }
        });
    });

    describe('buildRunArgs', () => {
        const args = buildRunArgs('omk-task-abc', '/tmp/ws/abc', cfg);
        const joined = args.join(' ');

        it('영속(-d) + tail -f /dev/null', () => {
            expect(args.slice(0, 5)).toEqual(['run', '-d', '--init', '--name', 'omk-task-abc']);
            expect(args.slice(-4)).toEqual([cfg.image, 'tail', '-f', '/dev/null']);
        });
        it('보안 플래그 전부 포함', () => {
            expect(joined).toContain('--cap-drop ALL');
            expect(joined).toContain('--security-opt no-new-privileges');
            expect(joined).toContain('--read-only');
            expect(joined).toContain('--user 1000:1000');
            expect(joined).toContain('--pids-limit');
            expect(joined).toContain('--memory');
            expect(joined).toContain('--cpus');
        });
        it('network none 매핑', () => {
            expect(buildRunArgs('n', '/w', { ...cfg, network: 'none' }).join(' ')).toContain('--network none');
        });
        it('workspace 볼륨만 rw 마운트', () => {
            expect(joined).toContain('-v /tmp/ws/abc:/workspace:rw');
            expect(joined).toContain('-w /workspace');
        });
        it('restricted 도 none 으로 fail-safe 매핑(메인 샌드박스 allowlist enforcement 미구현)', () => {
            const r = buildRunArgs('n', '/w', { ...cfg, network: 'restricted' });
            expect(r.join(' ')).toContain('--network none');
            expect(r.join(' ')).not.toContain('--network bridge');
        });
    });

    describe('buildBrowserRunArgs', () => {
        it('별도 일회성(--rm) 컨테이너 + browserNetwork + 러너 실행', () => {
            const r = buildBrowserRunArgs('/tmp/ws/abc', '.browser-actions.json', { ...cfg, browserNetwork: 'bridge' });
            const j = r.join(' ');
            expect(r.slice(0, 3)).toEqual(['run', '--rm', '--init']);
            expect(j).toContain('--network bridge'); // browser 만 인터넷
            expect(j).toContain('--cap-drop ALL');
            expect(j).toContain('--user 1000:1000');
            expect(j).toContain('-v /tmp/ws/abc:/workspace:rw');
            expect(r.slice(-4)).toEqual([cfg.image, 'node', '/opt/browser/browser-runner.mjs', '.browser-actions.json']);
        });
        it('egress 프록시 URL 주입 시 internal 망 + BROWSER_PROXY env', () => {
            const r = buildBrowserRunArgs('/tmp/ws/abc', '.browser-actions.json',
                { ...cfg, egressNetwork: 'omk-egress-internal' }, 'http://omk-egress-proxy:8888');
            const j = r.join(' ');
            expect(j).toContain('--network omk-egress-internal'); // bridge 아님(직접 인터넷 차단)
            expect(j).toContain('-e BROWSER_PROXY=http://omk-egress-proxy:8888');
        });
    });
});

describe('exec 타임아웃·취소 — 컨테이너 안 프로세스 정리', () => {
    /** docker 대역 — 인자를 기록한다. 꼬리표(OMK_EXEC_ID)가 붙은 exec 는 오래 도는 명령처럼 멈춰 있는다. */
    async function hangingDocker(dir: string): Promise<{ bin: string; log: string }> {
        const bin = join(dir, 'docker'); const log = join(dir, 'docker.log');
        await writeFile(bin, [
            '#!/bin/sh',
            `printf '%s\\n' "$*" >> '${log}'`,
            'case "$*" in',
            '  *"-e OMK_EXEC_ID="*HANG*) exec sleep 30 ;;',
            '  *) exit 0 ;;',
            'esac',
            '',
        ].join('\n'), 'utf8');
        await chmod(bin, 0o755);
        return { bin, log };
    }
    const lines = async (p: string) => (await readFile(p, 'utf8').catch(() => '')).split('\n').filter(Boolean);
    const execIdOf = (l: string[]) => /-e OMK_EXEC_ID=(\S+)/.exec(l.find((x) => x.includes('HANG')) ?? '')?.[1];
    const killLineOf = (l: string[], id: string | undefined) => l.find((x) => !x.includes('-e OMK_EXEC_ID=') && !!id && x.endsWith(` sh ${id}`));

    it('buildKillExecArgs: 실행 id 는 셸 문자열에 넣지 않고 위치 인자로 넘긴다', () => {
        const a = buildKillExecArgs('omk-task-abc', 'id-1');
        expect(a.slice(0, 4)).toEqual(['exec', 'omk-task-abc', 'sh', '-c']);
        expect(a[4]).toContain('OMK_EXEC_ID=$1');
        expect(a[4]).toContain('kill -9');
        expect(a.slice(5)).toEqual(['sh', 'id-1']);
    });

    it('타임아웃이면 같은 실행 id 의 컨테이너 안 프로세스를 죽인다', async () => {
        const base = await mkdtemp(join(tmpdir(), 'omk-exec-'));
        try {
            const { bin, log } = await hangingDocker(base);
            const sb = new TaskSandbox('k1', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: bin, execTimeoutMs: 300 });
            await sb.create();
            const r = await sb.exec('HANG');
            expect(r.timedOut).toBe(true);
            const l = await lines(log);
            expect(execIdOf(l)).toBeTruthy();
            expect(killLineOf(l, execIdOf(l))).toBeTruthy();
        } finally { await rm(base, { recursive: true, force: true }); }
    });

    it('abortRunning 은 실행 중인 명령을 타임아웃을 기다리지 않고 끝내고 컨테이너 안 프로세스를 죽인다', async () => {
        const base = await mkdtemp(join(tmpdir(), 'omk-exec-'));
        try {
            const { bin, log } = await hangingDocker(base);
            const sb = new TaskSandbox('k2', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: bin, execTimeoutMs: 20_000 });
            await sb.create();
            const started = Date.now();
            const pending = sb.exec('HANG');
            await new Promise((r) => setTimeout(r, 300));
            sb.abortRunning();
            const r = await pending;
            expect(Date.now() - started).toBeLessThan(5_000);
            expect(r.timedOut).toBe(false);
            expect(r.exitCode).not.toBe(0);
            const l = await lines(log);
            expect(killLineOf(l, execIdOf(l))).toBeTruthy();
        } finally { await rm(base, { recursive: true, force: true }); }
    });

    it('정상 종료한 명령에는 정리 호출을 하지 않는다', async () => {
        const base = await mkdtemp(join(tmpdir(), 'omk-exec-'));
        try {
            const { bin, log } = await hangingDocker(base);
            const sb = new TaskSandbox('k3', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: bin });
            await sb.create();
            expect((await sb.exec('echo ok')).exitCode).toBe(0);
            sb.abortRunning(); // 끝난 명령은 대상이 아니다
            expect((await lines(log)).filter((x) => x.includes('kill -9'))).toHaveLength(0);
        } finally { await rm(base, { recursive: true, force: true }); }
    });
});

describe('exec — 파이프라인 단계별 종료 코드(pipe-status)', () => {
    /** docker 대역 — `exec -e … <이름> sh -c <명령>` 은 호스트의 sh 로 그 명령을 workspace 에서 실제로 돌린다. 나머지는 성공. */
    async function shellDocker(dir: string, cwd: string): Promise<string> {
        const bin = join(dir, 'docker');
        await writeFile(bin, ['#!/bin/sh', 'case "$1 $2" in', `  "exec -e") shift 4; cd '${cwd}' && exec "$@" ;;`, '  *) exit 0 ;;', 'esac', ''].join('\n'), 'utf8');
        await chmod(bin, 0o755);
        return bin;
    }
    async function withSandbox(id: string, fn: (sb: TaskSandbox, ws: string) => Promise<void>): Promise<void> {
        const base = await mkdtemp(join(tmpdir(), 'omk-pipe-'));
        try {
            const sb = new TaskSandbox(id, { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws'), dockerPath: await shellDocker(base, join(base, 'ws', id)) });
            await sb.create();
            await fn(sb, join(base, 'ws', id));
        } finally { await rm(base, { recursive: true, force: true }); }
    }

    it('요청하면 앞 단계의 종료 코드를 싣고, 표식은 stderr 에 남기지 않는다', async () => {
        await withSandbox('p1', async (sb) => {
            const r = await sb.exec('sh -c "echo out; echo err >&2; exit 3" | cat', { pipeStatus: true });
            expect(r.exitCode).toBe(0);
            expect(r.stdout).toBe('out\n');
            expect(r.stderr).toBe('err\n');
            expect(r.pipeStages).toEqual([{ index: 1, command: 'sh -c "echo out; echo err >&2; exit 3"', exitCode: 3 }]);
        });
    });

    it('요청하지 않으면(다른 도구의 내부 실행) 감싸지 않는다', async () => {
        await withSandbox('p2', async (sb) => {
            const r = await sb.exec('false | true');
            expect(r.pipeStages).toBeUndefined();
        });
    });

    it('감싸도 명령의 출력·종료 코드·부수 효과가 같다', async () => {
        await withSandbox('p3', async (sb, ws) => {
            const commands = [
                'printf "a\\nb\\nc\\n" | grep b | wc -l',
                'mkdir -p sub && cd sub && pwd | sed "s|.*/||"',                 // 작업 디렉터리
                'FOO=bar; export FOO; env | grep "^FOO="',                         // 환경변수 유지
                'X=1 sh -c "echo $X-in" | cat',
                'echo "a | b && c; d" | cat',                                      // 따옴표 안 연산자
                'false | true',
                'true | false',
                'set -e; false | true; echo after',                                // set -e
                'set -e; false | true',
                'set -e; echo one | cat; false; echo never',
                'echo hi | cat > out.txt; cat out.txt',                            // 리다이렉션
                'ls /nonexistent-omk 2>&1 | wc -l',
                'echo a | cat;',
                'true && echo x | tr x y || echo no',
                'printf "l1\\nl2\\n" |\tcat',
                'echo one | cat\necho two | cat',                                  // 여러 줄(감싸지 않음)
                'cat <<EOF | tr a-z A-Z\nhello\nEOF',                              // here-doc(감싸지 않음)
                'sleep 0 | cat & wait; echo bg-done',                              // 백그라운드(감싸지 않음)
                'echo $(echo a | cat) | cat',                                      // 명령 치환(감싸지 않음)
            ];
            for (const c of commands) {
                const plain = await sb.exec(c);
                const wrapped = await sb.exec(c, { pipeStatus: true });
                expect({ c, out: wrapped.stdout, err: wrapped.stderr, code: wrapped.exitCode })
                    .toEqual({ c, out: plain.stdout, err: plain.stderr, code: plain.exitCode });
            }
            expect(await readFile(join(ws, 'out.txt'), 'utf8')).toBe('hi\n');
        });
    });
});
