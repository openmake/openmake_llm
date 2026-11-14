/**
 * 브라우저 다운로드 저장(설계 B-2) — Chrome 이 대기 폴더(연결 폴더 밖)에 `<guid>` 이름으로 받은 파일을, 완료 뒤 코어가
 * 저장 이름을 `write` 와 **같은 가드**(safeFromAsync + assertGitPathAllowed)로 판정해 연결 폴더로 옮긴다.
 * 제안 이름(Content-Disposition)은 믿지 않는다. 덮어쓰지 않는다 — 대상이 있으면 Chrome 과 같은 꼴 `이름 (n).확장자` 로 다음 후보를
 * 보고, 가드가 거절하면 다른 이름을 찾지 않고 그 다운로드를 버린다. 옮기기는 link(배타적 생성 — 대상 자리의 심링크를 따라가지
 * 않는다), 하드링크가 안 되는 자리면 연 대기 파일에서 배타적으로 만든 대상(`wx`)으로 복사한다. rename 은 대상을 덮어쓰므로 쓰지 않는다.
 * 대기 자리는 옮기기 전에 `lstat` 한다 — 보통 파일이고 링크 수가 1 일 때만 옮긴다(심링크·폴더·하드링크면 폴더 밖 파일이 같은
 * inode 로 들어올 수 있다). 옮긴 뒤 대상(link)·연 핸들(복사)이 그때 본 파일(dev·ino)인지 다시 확인한다 — 검사한 파일이 살아 있는
 * 동안의 바꿔 치기는 거절로 끝난다. inode 번호를 다시 쓰는 파일시스템(Linux ext4 등)에서 지우고 다시 만드는 경우는 남는 한계다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { BROWSER_DOWNLOAD_FALLBACK_NAME, BROWSER_DOWNLOAD_NAME_TRIES } from '../constants';
import { assertGitPathAllowed, type GitGuard } from '../git-trust';
import { safeFromAsync } from '../scope';

const fsp = fs.promises;
/** link 가 이 코드로 실패하면 copyFile 로 옮긴다 — 다른 볼륨·하드링크 없는 파일시스템 */
const COPY_FALLBACK_CODES = new Set(['EXDEV', 'EPERM', 'ENOTSUP']);
/** 복사 갈래에서 한 번에 읽는 크기 */
const COPY_CHUNK = 1 << 20;
const NOT_PLAIN = '다운로드 대기 파일이 보통 파일이 아니거나 다른 곳에 연결돼 있어 저장하지 않았습니다';

/** 가드(스코프·git)가 저장 이름을 거절했다 — 문구는 가드 문구 그대로(`write` 거절과 같은 글자). */
export class DownloadRejectedError extends Error {}

/** 제안 이름 — 경로 글자(/ \ NUL)가 있거나 빈·점 이름이면 대체 이름. 그 밖의 글자는 그대로 둔다(가드가 판정). */
function downloadName(suggested: string): string {
    return /[/\\\0]/.test(suggested) || suggested === '' || suggested === '.' || suggested === '..' ? BROWSER_DOWNLOAD_FALLBACK_NAME : suggested;
}

/** n 번째 후보 — 0 이면 이름 그대로, 아니면 확장자 앞에 " (n)". */
function candidate(name: string, n: number): string {
    if (n === 0) return name;
    const ext = path.extname(name);
    return `${name.slice(0, name.length - ext.length)} (${n})${ext}`;
}

const codeOf = (e: unknown): string | undefined => (e as NodeJS.ErrnoException)?.code;

/** 대기 자리를 lstat 에서 본 파일 — 옮긴 뒤 같은 파일인지 이것으로 확인한다. */
type StagedId = { dev: bigint; ino: bigint };
const sameFile = (st: fs.BigIntStats, id: StagedId): boolean => st.isFile() && st.dev === id.dev && st.ino === id.ino;

/** 연 대기 파일이 검사한 파일이면 그 핸들에서 배타적으로 만든 대상으로 복사한다 — 대상이 이미 있으면 false. */
async function copyExclusive(staged: string, dest: string, id: StagedId): Promise<boolean> {
    const src = await fsp.open(staged, 'r');
    try {
        const st = await src.stat({ bigint: true });
        if (!sameFile(st, id)) throw new Error(NOT_PLAIN);
        let out: fs.promises.FileHandle;
        try { out = await fsp.open(dest, 'wx'); } catch (c) {
            if (codeOf(c) === 'EEXIST') return false;
            throw c;
        }
        try {
            const buf = Buffer.allocUnsafe(COPY_CHUNK);
            for (let n = (await src.read(buf, 0, COPY_CHUNK, null)).bytesRead; n > 0; n = (await src.read(buf, 0, COPY_CHUNK, null)).bytesRead) {
                for (let off = 0; off < n;) off += (await out.write(buf, off, n - off)).bytesWritten;
            }
            await out.chmod(Number(st.mode & 0o777n));
            await out.close();
        } catch (c) {
            await out.close().catch(() => undefined);
            await fsp.unlink(dest).catch(() => undefined);
            throw c;
        }
        return true;
    } finally {
        await src.close().catch(() => undefined);
    }
}

/** 배타적으로 옮긴다 — 대상이 이미 있으면 false. 옮긴 대상이 검사한 파일이 아니면 지우고 던진다. */
async function moveExclusive(staged: string, dest: string, id: StagedId): Promise<boolean> {
    try {
        await fsp.link(staged, dest);
    } catch (e) {
        if (codeOf(e) === 'EEXIST') return false;
        if (!COPY_FALLBACK_CODES.has(codeOf(e) ?? '')) throw e;
        return copyExclusive(staged, dest, id);
    }
    if (!sameFile(await fsp.lstat(dest, { bigint: true }), id)) {
        await fsp.unlink(dest).catch(() => undefined);
        throw new Error(NOT_PLAIN);
    }
    return true;
}

/**
 * 대기 파일을 연결 폴더(base)로 옮기고 저장된 이름(base 기준)을 돌려준다. 가드 거절은 DownloadRejectedError,
 * 그 밖의 실패는 원래 오류로 던진다. 어느 쪽이든 대기 파일은 지운다.
 */
export async function placeDownload(base: string, guard: GitGuard, suggested: string, staged: string): Promise<string> {
    const name = downloadName(suggested);
    try {
        const st = await fsp.lstat(staged, { bigint: true });
        if (!st.isFile() || st.nlink !== 1n) throw new Error(NOT_PLAIN);
        const id = { dev: st.dev, ino: st.ino };
        for (let n = 0; n < BROWSER_DOWNLOAD_NAME_TRIES; n++) {
            const rel = candidate(name, n);
            let abs: string;
            try {
                abs = await safeFromAsync(base, rel);
                await assertGitPathAllowed(guard, abs, rel, false);
            } catch (e) {
                throw new DownloadRejectedError(e instanceof Error ? e.message : String(e));
            }
            if (await moveExclusive(staged, abs, id)) return rel;
        }
        throw new Error(`같은 이름의 파일이 너무 많아 저장하지 않았습니다: ${name}`);
    } finally {
        await fsp.unlink(staged).catch(() => undefined);
    }
}
