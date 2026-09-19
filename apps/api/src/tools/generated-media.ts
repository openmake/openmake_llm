/**
 * @module mcp/generated-media
 * @description 모달리티 도구(이미지·오디오·영상)가 만든 파일을 백엔드 정적 경로(/generated/*)에 저장한다.
 * apps/legacy-web/public/generated 을 express.static 이 항상 서빙한다(middlewares/setup.ts).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/** 생성 파일 저장 디렉토리 — 백엔드가 /generated/* 로 노출하는 정적 경로 */
export function resolveGeneratedDir(): string {
    return path.resolve(__dirname, '../../../../apps/legacy-web/public/generated');
}

/** 확장자 화이트리스트 — 경로 조작·임의 확장자 저장 차단 */
const SAFE_EXT = /^[a-z0-9]{1,5}$/;

export function saveGeneratedFile(prefix: string, ext: string, data: Buffer): { filename: string; urlPath: string; absPath: string } {
    if (!SAFE_EXT.test(ext)) throw new Error(`허용되지 않는 확장자: ${ext}`);
    const dir = resolveGeneratedDir();
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const absPath = path.join(dir, filename);
    fs.writeFileSync(absPath, data);
    return { filename, urlPath: `/generated/${filename}`, absPath };
}

/** `/generated/<file>` 경로를 실파일로 해석 — 디렉토리 밖·심링크 탈출 차단. 없으면 null */
export function resolveGeneratedPath(urlPath: string): string | null {
    const m = /^\/generated\/([A-Za-z0-9._-]+)$/.exec(urlPath.trim());
    if (!m) return null;
    const dir = resolveGeneratedDir();
    const abs = path.join(dir, m[1]);
    try {
        const real = fs.realpathSync(abs);
        if (!real.startsWith(fs.realpathSync(dir) + path.sep)) return null;
        return real;
    } catch {
        return null;
    }
}
