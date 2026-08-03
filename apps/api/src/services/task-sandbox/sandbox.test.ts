import { mkdtemp, mkdir, writeFile, symlink, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { buildRunArgs, buildBrowserRunArgs, safeResolveWorkspacePath, safeRealWorkspacePath, sanitizeId, dirSizeBytes, listWorkspaceFilesAt, TaskSandbox } from './sandbox';
import { getTaskSandboxConfig } from '../../config/task-sandbox';

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
