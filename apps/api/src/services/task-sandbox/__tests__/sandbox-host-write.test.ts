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
import { writeFileNoFollow, ensurePrivateRoot } from '../sandbox-host-write';

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

    describe('ensurePrivateRoot', () => {
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
