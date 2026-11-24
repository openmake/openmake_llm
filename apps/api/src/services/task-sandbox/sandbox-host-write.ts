/**
 * task 샌드박스 호스트 쪽 쓰기 보조 (보안 점검 E7·E8).
 *
 * - writeFileNoFollow / copyFileNoFollow: 경로 검사 뒤 마지막 경로 요소가 심링크로 바뀌어도(TOCTOU) 그 심링크를 따라가
 *   workspace 밖 파일을 덮어쓰지 않도록 O_NOFOLLOW 로 연다(심링크면 ELOOP).
 * - writeFileAtomicNoFollow: 같은 폴더의 임시 파일에 다 쓴 뒤 rename 으로 바꿔 끼운다(하네스 검토 P2-6 잔여) —
 *   쓰는 도중 실패·중단돼도 원본이 반쯤 잘린 채 남지 않고, 읽는 쪽은 옛 내용 또는 새 내용 둘 중 하나만 본다.
 * - ensurePrivateRoot: task workspace 루트를 0o700 으로 둔다 — 다른 계정이 작업 폴더에 들어오지 못한다.
 */
import { constants } from 'fs';
import { randomBytes } from 'crypto';
import { basename, dirname, join } from 'path';
import { open, mkdir, chmod, lstat, rename, unlink, type FileHandle } from 'fs/promises';

const COPY_CHUNK_BYTES = 1024 * 1024;
const NO_FOLLOW_WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;

function openNoFollow(abs: string): Promise<FileHandle> {
    return open(abs, NO_FOLLOW_WRITE_FLAGS, 0o644);
}

export async function writeFileNoFollow(abs: string, content: string | Buffer): Promise<void> {
    const fh = await openNoFollow(abs);
    try {
        await fh.writeFile(content);
    } finally {
        await fh.close();
    }
}

/** 원자적 쓰기의 임시 파일 접두 — 프로세스가 rename 전에 죽어 남은 임시 파일을 알아볼 수 있게 한다(호스트·컨테이너 공용). */
export const ATOMIC_WRITE_TMP_PREFIX = '.omk-write-';

/**
 * 원자적 교체 쓰기 — 대상이 심링크면 writeFileNoFollow 와 같이 ELOOP 로 거부한다(대상 파일을 건드리지 않는다).
 * 기존 파일의 권한 비트(실행 권한 등)를 이어받고, 새 파일은 0o644. 임시 파일은 O_EXCL|O_NOFOLLOW 로 만들고
 * 실패하면 지운다. rename 은 같은 파일시스템 안의 교체라 원자적이다(같은 폴더에 만들기 때문).
 */
export async function writeFileAtomicNoFollow(abs: string, content: string | Buffer): Promise<void> {
    let mode = 0o644;
    try {
        const st = await lstat(abs);
        if (st.isSymbolicLink()) {
            throw Object.assign(new Error(`ELOOP: 심링크에는 쓰지 않습니다: ${abs}`), { code: 'ELOOP' });
        }
        mode = st.mode & 0o7777;
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const tmp = join(dirname(abs), `${ATOMIC_WRITE_TMP_PREFIX}${basename(abs)}.${randomBytes(6).toString('hex')}`);
    const fh = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
        try {
            await fh.writeFile(content);
            await fh.chmod(mode); // umask 와 무관하게 원래 권한으로
            await fh.sync();
        } finally {
            await fh.close();
        }
        await rename(tmp, abs);
    } catch (e) {
        await unlink(tmp).catch(() => undefined);
        throw e;
    }
}

/** 원본을 메모리에 다 올리지 않고 스트림으로 복사한다(대용량 입력 첨부). */
export async function copyFileNoFollow(src: string, dest: string): Promise<void> {
    const out = await openNoFollow(dest);
    try {
        const inp = await open(src, 'r');
        try {
            const buf = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
            for (;;) {
                const { bytesRead } = await inp.read(buf, 0, buf.length, null);
                if (bytesRead === 0) break;
                let off = 0;
                while (off < bytesRead) off += (await out.write(buf, off, bytesRead - off)).bytesWritten;
            }
        } finally {
            await inp.close();
        }
    } finally {
        await out.close();
    }
}

export async function ensurePrivateRoot(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    if ((await lstat(dir)).isSymbolicLink()) {
        throw new Error(`TASK_SANDBOX_ROOT(${dir}) 가 심링크입니다 — 서버 계정이 소유한 실제 디렉터리를 지정하세요.`);
    }
    try {
        await chmod(dir, 0o700);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') {
            throw new Error(`TASK_SANDBOX_ROOT(${dir}) 권한을 0700 으로 바꾸지 못했습니다 — 이 디렉터리는 서버 계정이 소유해야 합니다(must be owned by the server user).`);
        }
        throw err;
    }
}
