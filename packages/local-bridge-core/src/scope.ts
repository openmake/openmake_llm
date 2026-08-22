/**
 * 경로 스코프 가드 — base 밖 경로/심링크 탈출을 차단.
 * 서버 safeRealWorkspacePath 등가(폴더 선택으로 base 일반화). 컨테이너 없는 로컬에서는
 * 심링크가 유일한 탈출로라, 존재하는 최근접 조상의 realpath 까지 검증한다.
 */
import * as fs from 'fs';
import * as path from 'path';

export function safeFrom(baseAbs: string, rel: string | undefined): string {
    const abs = path.resolve(baseAbs, rel || '.');
    if (abs !== baseAbs && !abs.startsWith(baseAbs + path.sep)) throw new Error(`폴더 스코프 밖 경로 거부: ${rel}`);
    let probe = abs;
    while (!fs.existsSync(probe)) probe = path.dirname(probe);
    const real = fs.realpathSync(probe);
    const baseReal = fs.realpathSync(baseAbs);
    if (real !== baseReal && !real.startsWith(baseReal + path.sep)) throw new Error(`심링크 스코프 탈출 거부: ${rel}`);
    return abs;
}
