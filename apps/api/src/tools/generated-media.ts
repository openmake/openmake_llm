/**
 * @module tools/generated-media
 * @description 오케스트레이터가 만든 미디어 파일의 **경로 해석** — 두 디렉토리를 안다(P04, 2026-09-23).
 *  - 공개 root `apps/legacy-web/public/generated`: 종전 파일(소유권 백필 대상)과 예약 리포트(`reports/`). express.static 이 서빙한다.
 *  - 비공개 root(`GENERATED_PRIVATE_DIR`, 기본 `apps/legacy-web/generated-private`): **신규 파일은 전부 여기** — 정적 서빙 밖이라
 *    인증된 `/generated/<name>` 핸들러(routes/generated-artifacts.routes.ts)만 소유권을 확인하고 내려준다.
 * 저장·소유 레코드는 `runtime-ports/artifact-store.ts` 가 맡는다. 여기엔 파일 시스템 해석만 둔다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/** 종전 공개 저장 디렉토리 — 백엔드가 /generated/* 로 노출하는 정적 경로(신규 저장은 하지 않는다) */
export function resolveGeneratedDir(): string {
    return path.resolve(__dirname, '../../../../apps/legacy-web/public/generated');
}

/** 신규 산출물 디렉토리 — 공개 정적 root 밖. env 로 배포마다 바꿀 수 있다 */
export function resolveGeneratedPrivateDir(): string {
    const env = process.env.GENERATED_PRIVATE_DIR?.trim();
    return env ? path.resolve(env) : path.resolve(__dirname, '../../../../apps/legacy-web/generated-private');
}

/** 확장자 화이트리스트 — 경로 조작·임의 확장자 저장 차단 */
const SAFE_EXT = /^[a-z0-9]{1,5}$/;
export const GENERATED_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function newGeneratedFileName(prefix: string, ext: string): string {
    if (!SAFE_EXT.test(ext)) throw new Error(`허용되지 않는 확장자: ${ext}`);
    if (!/^[a-z0-9-]{1,20}$/.test(prefix)) throw new Error(`허용되지 않는 접두: ${prefix}`);
    return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
}

/** 비공개 디렉토리에 쓴다 — 소유 레코드 없이 부르지 말 것(artifact-store 가 유일한 호출부) */
export function writeGeneratedFilePrivate(filename: string, data: Buffer): { absPath: string; urlPath: string } {
    if (!GENERATED_NAME_PATTERN.test(filename) || filename.includes('/')) throw new Error(`허용되지 않는 파일명: ${filename}`);
    const dir = resolveGeneratedPrivateDir();
    fs.mkdirSync(dir, { recursive: true });
    const absPath = path.join(dir, filename);
    fs.writeFileSync(absPath, data);
    return { absPath, urlPath: `/generated/${filename}` };
}

function resolveInside(dir: string, name: string): string | null {
    try {
        const real = fs.realpathSync(path.join(dir, name));
        return real.startsWith(fs.realpathSync(dir) + path.sep) ? real : null;
    } catch {
        return null;
    }
}

/**
 * `/generated/<file>` 경로를 실파일로 해석 — 비공개 → 공개 순, 디렉토리 밖·심링크 탈출 차단. 없으면 null.
 * **존재 확인용**이다(링크 가드·job 저장본 판정). 사용자에게 내려주는 경로는 소유권을 보는 artifact-store 를 쓸 것.
 */
export function resolveGeneratedPath(urlPath: string): string | null {
    const m = /^\/generated\/([A-Za-z0-9._-]+)$/.exec(urlPath.trim());
    if (!m) return null;
    return resolveInside(resolveGeneratedPrivateDir(), m[1]) ?? resolveInside(resolveGeneratedDir(), m[1]);
}

/** 파일명이 어느 디렉토리에 있는지 — 핸들러가 레코드의 storage 와 대조한다 */
export function locateGeneratedFile(name: string): { absPath: string; storage: 'private' | 'legacy_public' } | null {
    if (!GENERATED_NAME_PATTERN.test(name)) return null;
    const priv = resolveInside(resolveGeneratedPrivateDir(), name);
    if (priv) return { absPath: priv, storage: 'private' };
    const pub = resolveInside(resolveGeneratedDir(), name);
    return pub ? { absPath: pub, storage: 'legacy_public' } : null;
}
