/**
 * 원자적 교체 쓰기 (TASK_SANDBOX_ATOMIC_WRITE, 하네스 검토 P2-6 잔여).
 * 임시 파일 → rename. 심링크 거부·권한 보존·실패 시 원본 보존·임시 파일 정리를 고정한다.
 */
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, stat, chmod, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { writeFileAtomicNoFollow, ATOMIC_WRITE_TMP_PREFIX } from '../sandbox-host-write';
import { buildWriteArgs } from '../sandbox-docker-cli';
import { TaskSandbox } from '../sandbox';
import { getTaskSandboxConfig } from '../../../config/task-sandbox';

let base: string;
beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'omk-atomic-')); });
afterEach(async () => { await rm(base, { recursive: true, force: true }); });
const leftovers = async (dir: string) => (await readdir(dir)).filter((n) => n.startsWith(ATOMIC_WRITE_TMP_PREFIX));

describe('writeFileAtomicNoFollow', () => {
    it('새 파일을 만들고(0o644) 임시 파일을 남기지 않는다', async () => {
        const p = join(base, 'a.txt');
        await writeFileAtomicNoFollow(p, 'hello');
        expect(await readFile(p, 'utf8')).toBe('hello');
        expect((await stat(p)).mode & 0o777).toBe(0o644);
        expect(await leftovers(base)).toEqual([]);
    });

    it('기존 파일을 바꿔 끼우되 권한(실행 비트)은 이어받는다 — 새 inode', async () => {
        const p = join(base, 'run.sh');
        await writeFile(p, 'echo old\n');
        await chmod(p, 0o755);
        const before = await stat(p);
        await writeFileAtomicNoFollow(p, Buffer.from('echo new\n'));
        const after = await stat(p);
        expect(await readFile(p, 'utf8')).toBe('echo new\n');
        expect(after.mode & 0o777).toBe(0o755);
        expect(after.ino).not.toBe(before.ino);
    });

    it('대상이 심링크면 ELOOP 로 거부하고 링크 대상·링크 자체를 건드리지 않는다', async () => {
        const outside = join(base, 'outside.txt');
        await writeFile(outside, 'original');
        const link = join(base, 'link.txt');
        await symlink(outside, link);
        await expect(writeFileAtomicNoFollow(link, 'x')).rejects.toMatchObject({ code: 'ELOOP' });
        expect(await readFile(outside, 'utf8')).toBe('original');
        expect(await leftovers(base)).toEqual([]);
    });

    it('교체에 실패하면 원본을 그대로 두고 임시 파일을 지운다', async () => {
        const dir = join(base, 'target-is-dir');
        await mkdir(join(dir, 'sub'), { recursive: true });
        // 디렉터리 자리로는 rename 할 수 없다(EISDIR/ENOTEMPTY) — 그 실패 경로
        await expect(writeFileAtomicNoFollow(dir, 'x')).rejects.toBeTruthy();
        expect((await stat(dir)).isDirectory()).toBe(true);
        expect(await leftovers(base)).toEqual([]);
    });
});

describe('buildWriteArgs atomic (컨테이너 쓰기)', () => {
    it('기본은 종전 인자 그대로', () => {
        expect(buildWriteArgs('c', '/workspace/a.py')).toEqual(['exec', '-i', 'c', 'sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', '/workspace/a.py']);
    });

    it('atomic 스크립트를 실제 sh 로 돌리면 임시 파일 → mv 로 바꿔 끼우고 권한을 지킨다(경로는 위치 인자)', async () => {
        const args = buildWriteArgs('c', 'x', { atomic: true });
        const script = args[5];
        expect(args[6]).toBe('sh');
        const p = join(base, 'dir with space', 'a;b.sh');
        // 새 파일(하위 폴더 생성 포함)
        const write = (content: string) => new Promise<void>((resolve, reject) => {
            const child = execFile('sh', ['-c', script, 'sh', p], (err) => (err ? reject(err) : resolve()));
            child.stdin?.end(content);
        });
        await write('v1\n');
        expect(await readFile(p, 'utf8')).toBe('v1\n');
        await chmod(p, 0o755);
        await write('v2\n');
        expect(await readFile(p, 'utf8')).toBe('v2\n');
        expect((await stat(p)).mode & 0o777).toBe(0o755);
        expect(await leftovers(join(base, 'dir with space'))).toEqual([]);
    });

    it('권한을 cp -p 에 맡기지 않는다 — cp 가 권한을 버리는 마운트(Colima virtiofs)에서도 덮어쓴 파일의 권한이 유지된다', async () => {
        // virtiofs 의 cp -p 흉내: 성공(0)을 돌려주지만 사본은 0600. 종전 스크립트는 덮어쓴 파일이 0600 이 됐다.
        const bin = join(base, 'bin');
        await mkdir(bin);
        await writeFile(join(bin, 'cp'), '#!/bin/sh\nfor a; do :; done\nsrc=""; for x; do [ "$x" = "-p" ] || { [ -z "$src" ] && src="$x" || dst="$x"; }; done\ncat "$src" > "$dst"; chmod 600 "$dst"\n');
        await chmod(join(bin, 'cp'), 0o755);
        const script = buildWriteArgs('c', 'x', { atomic: true })[5];
        const p = join(base, 'keep.txt');
        const write = (content: string) => new Promise<void>((resolve, reject) => {
            const child = execFile('sh', ['-c', script, 'sh', p], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
                (err) => (err ? reject(err) : resolve()));
            child.stdin?.end(content);
        });
        await writeFile(p, 'v1\n');
        await chmod(p, 0o644);
        await write('v2\n');
        expect(await readFile(p, 'utf8')).toBe('v2\n');
        expect((await stat(p)).mode & 0o777).toBe(0o644);
        expect(await leftovers(base)).toEqual([]);
    });
});

describe('TaskSandbox.writeFile — atomicWrite 설정', () => {
    it('켜면 호스트 쓰기가 교체 방식이 된다(새 inode), 끄면(기본) 같은 inode 에 덮어쓴다', async () => {
        const on = new TaskSandbox('aw-on', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws1'), atomicWrite: true });
        const off = new TaskSandbox('aw-off', { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws2'), atomicWrite: false });
        for (const [sb, expectNewInode] of [[on, true], [off, false]] as const) {
            await mkdir(sb.hostWorkdir, { recursive: true }); // create() 는 docker 를 띄우므로 workspace 만 만든다
            await sb.writeFile('f.txt', 'one');
            const i1 = (await stat(join(sb.hostWorkdir, 'f.txt'))).ino;
            await sb.writeFile('f.txt', 'two');
            const i2 = (await stat(join(sb.hostWorkdir, 'f.txt'))).ino;
            expect(await readFile(join(sb.hostWorkdir, 'f.txt'), 'utf8')).toBe('two');
            expect(i2 !== i1).toBe(expectNewInode);
        }
    });
});
