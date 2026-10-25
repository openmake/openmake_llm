/**
 * task 샌드박스 호스트 쪽 쓰기 보조 (보안 점검 E7·E8).
 *
 * - writeFileNoFollow: 경로 검사 뒤 마지막 경로 요소가 심링크로 바뀌어도(TOCTOU) 그 심링크를 따라가
 *   workspace 밖 파일을 덮어쓰지 않도록 O_NOFOLLOW 로 연다(심링크면 ELOOP).
 * - ensurePrivateRoot: task workspace 루트를 0o700 으로 둔다 — 다른 계정이 작업 폴더에 들어오지 못한다.
 */
import { constants } from 'fs';
import { open, mkdir, chmod } from 'fs/promises';

export async function writeFileNoFollow(abs: string, content: string | Buffer): Promise<void> {
    const fh = await open(abs, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
    try {
        await fh.writeFile(content);
    } finally {
        await fh.close();
    }
}

export async function ensurePrivateRoot(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await chmod(dir, 0o700);
}
