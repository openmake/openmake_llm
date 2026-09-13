/**
 * 경로 스코프 가드 — base 밖 경로/심링크 탈출을 차단.
 * 서버 safeRealWorkspacePath 등가(폴더 선택으로 base 일반화). 컨테이너 없는 로컬에서는
 * 심링크가 유일한 탈출로라, 존재하는 최근접 조상의 realpath 까지 검증한다.
 */
import * as fs from 'fs';
import * as path from 'path';

/** lstat 기반 존재 확인 — 심링크는 대상이 없어도 "존재"로 본다(realpath 가 이어서 판정). */
function lstatExistsSync(p: string): boolean {
    try { fs.lstatSync(p); return true; } catch { return false; }
}

export function safeFrom(baseAbs: string, rel: string | undefined): string {
    const abs = path.resolve(baseAbs, rel || '.');
    if (abs !== baseAbs && !abs.startsWith(baseAbs + path.sep)) throw new Error(`폴더 스코프 밖 경로 거부: ${rel}`);
    // ⚠️ existsSync 는 stat(심링크 추적)이라 대상이 없는(dangling) 심링크를 "없음"으로 보고 조상으로
    // 올라가 통과시켰다 — 이후 write 가 링크를 따라가 base 밖에 파일을 만든다. lstat 로 링크 자체의
    // 존재를 보고, realpath 가 ENOENT 를 던지면(dangling) 그대로 거부한다(fail-closed). (2026-09-13)
    let probe = abs;
    while (!lstatExistsSync(probe)) probe = path.dirname(probe);
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
    while (!(await fs.promises.lstat(probe).then(() => true, () => false))) probe = path.dirname(probe);
    const real = await fs.promises.realpath(probe);
    const baseReal = await fs.promises.realpath(baseAbs);
    if (real !== baseReal && !real.startsWith(baseReal + path.sep)) throw new Error(`심링크 스코프 탈출 거부: ${rel}`);
    return abs;
}
