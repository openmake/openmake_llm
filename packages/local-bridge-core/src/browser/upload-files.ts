/**
 * 업로드할 파일 검사 — uploadFile 이 사이트로 내보낼 수 있는 파일은 그 작업의 연결 폴더 안에 있는 보통 파일뿐이다(2026-10-06).
 *
 * 거절: 상대 경로가 아닌 것(절대 경로·드라이브 문자), `..` 구간, 숨김 파일·숨김 폴더 안(이름이 `.` 으로 시작 — `.env`·`.git` 등),
 * 심볼릭 링크로 폴더 밖이나 숨김 파일로 나가는 것, 폴더·없는 파일, 크기 상한 초과, 파일 수 상한 초과.
 * 통과한 파일은 실제 경로(realpath)로 돌려준다 — 브라우저에는 검사한 그 파일을 넘긴다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { safeFromAsync } from '../scope';
import { BROWSER_UPLOAD_MAX_FILE_BYTES, BROWSER_UPLOAD_MAX_FILES } from '../constants';

/** 경로 구간 구분 — 서버·모델은 `/` 를 쓰지만 Windows 표기도 같은 규칙으로 본다 */
const SEGMENT_SPLIT_RE = /[\\/]+/;
/** Windows 드라이브 문자로 시작하는 경로 */
const DRIVE_RE = /^[A-Za-z]:/;

function isHiddenPath(segments: readonly string[]): boolean {
    return segments.some((s) => s.startsWith('.'));
}

async function resolveOne(baseReal: string, rel: unknown): Promise<string> {
    if (typeof rel !== 'string' || rel.trim() === '') throw new Error('업로드할 파일 이름이 비어 있습니다');
    if (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || DRIVE_RE.test(rel)) throw new Error(`폴더 기준 상대 경로만 올릴 수 있습니다: ${rel}`);
    const segments = rel.split(SEGMENT_SPLIT_RE).filter((s) => s !== '' && s !== '.');
    if (segments.includes('..')) throw new Error(`폴더 밖 파일은 올릴 수 없습니다: ${rel}`);
    if (isHiddenPath(segments)) throw new Error(`숨김 파일은 올릴 수 없습니다: ${rel}`);
    const abs = await safeFromAsync(baseReal, segments.join(path.sep));
    const real = await fs.promises.realpath(abs).catch(() => { throw new Error(`파일이 없습니다: ${rel}`); });
    const inside = path.relative(baseReal, real);
    if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error(`폴더 밖 파일은 올릴 수 없습니다: ${rel}`);
    if (isHiddenPath(inside.split(SEGMENT_SPLIT_RE))) throw new Error(`숨김 파일은 올릴 수 없습니다: ${rel}`);
    const st = await fs.promises.stat(real);
    if (!st.isFile()) throw new Error(`파일이 아닙니다: ${rel}`);
    if (st.size > BROWSER_UPLOAD_MAX_FILE_BYTES) throw new Error(`파일이 너무 큽니다(${st.size}b > ${BROWSER_UPLOAD_MAX_FILE_BYTES}b): ${rel}`);
    return real;
}

/** 연결 폴더(baseAbs) 기준 상대 경로 목록 → 검사를 통과한 실제 경로 목록. 하나라도 걸리면 사유를 담아 던진다. */
export async function resolveUploadFiles(baseAbs: string, files: unknown): Promise<string[]> {
    if (!Array.isArray(files) || files.length === 0) throw new Error('uploadFile 액션에는 files(폴더 기준 상대 경로 배열)가 필요합니다');
    if (files.length > BROWSER_UPLOAD_MAX_FILES) throw new Error(`한 번에 올릴 수 있는 파일은 ${BROWSER_UPLOAD_MAX_FILES}개까지입니다(${files.length}개)`);
    const baseReal = await fs.promises.realpath(baseAbs);
    const out: string[] = [];
    for (const rel of files) out.push(await resolveOne(baseReal, rel));
    return out;
}
