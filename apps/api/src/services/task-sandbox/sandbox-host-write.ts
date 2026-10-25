/**
 * task 샌드박스 호스트 쪽 쓰기 보조 (보안 점검 E7·E8).
 *
 * - writeFileNoFollow / copyFileNoFollow: 경로 검사 뒤 마지막 경로 요소가 심링크로 바뀌어도(TOCTOU) 그 심링크를 따라가
 *   workspace 밖 파일을 덮어쓰지 않도록 O_NOFOLLOW 로 연다(심링크면 ELOOP).
 * - ensurePrivateRoot: task workspace 루트를 0o700 으로 둔다 — 다른 계정이 작업 폴더에 들어오지 못한다.
 */
import { constants } from 'fs';
import { open, mkdir, chmod, lstat, type FileHandle } from 'fs/promises';

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
