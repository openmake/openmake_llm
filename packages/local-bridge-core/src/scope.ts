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

/**
 * safeFrom 의 async 판 — 파일 kind 처리 경로 전용. OS 가 FS 호출을 무기한 블록해도
 * (예: 외장 볼륨 TCC 권한 미결) libuv threadpool 에서 대기해 이벤트 루프(WS pong)가
 * 계속 돌게 한다. 검증 의미는 sync 판과 동일하게 유지할 것.
 */
export async function safeFromAsync(baseAbs: string, rel: string | undefined): Promise<string> {
    const abs = path.resolve(baseAbs, rel || '.');
    if (abs !== baseAbs && !abs.startsWith(baseAbs + path.sep)) throw new Error(`폴더 스코프 밖 경로 거부: ${rel}`);
    let probe = abs;
    while (!(await fs.promises.access(probe).then(() => true, () => false))) probe = path.dirname(probe);
    const real = await fs.promises.realpath(probe);
    const baseReal = await fs.promises.realpath(baseAbs);
    if (real !== baseReal && !real.startsWith(baseReal + path.sep)) throw new Error(`심링크 스코프 탈출 거부: ${rel}`);
    return abs;
}
