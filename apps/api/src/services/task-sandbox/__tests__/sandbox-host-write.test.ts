/**
 * 호스트 폴백 쓰기·workspace 루트 권한 (보안 점검 E7·E8).
 *
 * E7: 경로 검사(safeRealWorkspacePath) 뒤 실제 쓰기 전에 마지막 경로 요소를 심링크로 바꿔치기하면
 *     workspace 밖 파일이 덮어써진다(TOCTOU). 쓰기는 O_NOFOLLOW 로 열어 심링크를 따라가지 않는다.
 * E8: task workspace 루트가 0o777 이면 다른 계정이 작업 폴더를 들여다본다. 루트는 0o700.
 */
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, stat, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
// chmod EPERM 을 흉내 내려고 chmod 만 감싼다(나머지는 실제 구현).
jest.mock('fs/promises', () => {
    const actual = jest.requireActual('fs/promises');
    return { ...actual, chmod: jest.fn(actual.chmod) };
});
import { writeFileNoFollow, copyFileNoFollow, ensurePrivateRoot } from '../sandbox-host-write';
import { TaskSandbox } from '../sandbox';
import * as workspaceFs from '../sandbox-workspace-fs';
import { getTaskSandboxConfig } from '../../../config/task-sandbox';

describe('sandbox-host-write', () => {
    let base: string;
    beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'omk-host-write-')); });
    afterEach(async () => { await rm(base, { recursive: true, force: true }); });

    describe('writeFileNoFollow', () => {
        it('마지막 경로 요소가 심링크면 ELOOP 로 거부하고 대상 파일을 건드리지 않는다', async () => {
            const outside = join(base, 'outside.txt');
            await writeFile(outside, 'original');
            const link = join(base, 'link.txt');
            await symlink(outside, link);
            await expect(writeFileNoFollow(link, 'x')).rejects.toMatchObject({ code: 'ELOOP' });
            expect(await readFile(outside, 'utf8')).toBe('original');
        });

        it('일반 경로는 새로 만들어 기록한다(string·Buffer)', async () => {
            const p = join(base, 'a.txt');
            await writeFileNoFollow(p, 'hello');
            expect(await readFile(p, 'utf8')).toBe('hello');
            const q = join(base, 'b.bin');
            await writeFileNoFollow(q, Buffer.from([1, 2, 3]));
            expect([...(await readFile(q))]).toEqual([1, 2, 3]);
        });

        it('기존 파일은 잘라내고 덮어쓴다', async () => {
            const p = join(base, 'c.txt');
            await writeFile(p, 'a much longer original content');
            await writeFileNoFollow(p, 'short');
            expect(await readFile(p, 'utf8')).toBe('short');
        });
    });

    describe('copyFileNoFollow', () => {
        it('대상이 심링크면 ELOOP 로 거부하고 링크 대상 파일을 건드리지 않는다', async () => {
            const src = join(base, 'src.txt');
            await writeFile(src, 'payload');
            const outside = join(base, 'outside.txt');
            await writeFile(outside, 'original');
            const link = join(base, 'dest.txt');
            await symlink(outside, link);
            await expect(copyFileNoFollow(src, link)).rejects.toMatchObject({ code: 'ELOOP' });
            expect(await readFile(outside, 'utf8')).toBe('original');
        });

        it('일반 대상에는 원본 내용을 복사하고 기존 내용은 잘라낸다', async () => {
            const src = join(base, 'src.bin');
            const big = Buffer.alloc(200_000, 7);
            await writeFile(src, big);
            const dest = join(base, 'dest.bin');
            await writeFile(dest, Buffer.alloc(300_000, 1));
            await copyFileNoFollow(src, dest);
            expect((await readFile(dest)).equals(big)).toBe(true);
        });
    });

    describe('TaskSandbox.importFile', () => {
        it('경로 검사 뒤 대상이 심링크로 바뀌면(TOCTOU) ELOOP 로 거부하고 링크 대상 파일을 덮어쓰지 않는다', async () => {
            const cfg = { ...getTaskSandboxConfig(), workspaceRoot: join(base, 'ws') };
            const sb = new TaskSandbox('t-import', cfg);
            await mkdir(sb.hostWorkdir, { recursive: true });
            const dest = join(sb.hostWorkdir, 'in.txt');
            await writeFile(dest, 'old');
            const outside = join(base, 'host-secret.txt');
            await writeFile(outside, 'original');
            const src = join(base, 'upload.bin');
            await writeFile(src, 'payload');
            // 경로 검사(safeRealWorkspacePath)와 쓰기 사이 — 쿼터 계산 시점에 대상을 바깥을 가리키는 심링크로 바꿔치기
            const spy = jest.spyOn(workspaceFs, 'dirSizeBytes').mockImplementationOnce(async () => {
                await rm(dest);
                await symlink(outside, dest);
                return 0;
            });
            try {
                await expect(sb.importFile('in.txt', src)).rejects.toMatchObject({ code: 'ELOOP' });
            } finally {
                spy.mockRestore();
            }
            expect(await readFile(outside, 'utf8')).toBe('original');
        });
    });

    describe('ensurePrivateRoot', () => {
        it('루트 자체가 심링크면 거부한다', async () => {
            const real = join(base, 'real');
            await mkdir(real);
            await chmod(real, 0o755);
            const link = join(base, 'root-link');
            await symlink(real, link);
            await expect(ensurePrivateRoot(link)).rejects.toThrow(/TASK_SANDBOX_ROOT/);
            expect((await stat(real)).mode & 0o777).toBe(0o755);
        });

        it('chmod 가 EPERM 이면 TASK_SANDBOX_ROOT 소유자 안내로 다시 던진다', async () => {
            const root = join(base, 'root');
            (chmod as unknown as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }));
            await expect(ensurePrivateRoot(root)).rejects.toThrow(/TASK_SANDBOX_ROOT.*(소유|owned)/);
        });

        it('없는 디렉터리를 만들고 0o700 으로 둔다', async () => {
            const root = join(base, 'nested', 'root');
            await ensurePrivateRoot(root);
            expect((await stat(root)).mode & 0o777).toBe(0o700);
        });

        it('이미 있는 다른 권한의 디렉터리도 0o700 으로 바꾸고, 반복 호출해도 같다', async () => {
            const root = join(base, 'root');
            await mkdir(root);
            await chmod(root, 0o777);
            await ensurePrivateRoot(root);
            expect((await stat(root)).mode & 0o777).toBe(0o700);
            await ensurePrivateRoot(root);
            expect((await stat(root)).mode & 0o777).toBe(0o700);
        });
    });
});
