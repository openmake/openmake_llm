/**
 * docker 바이너리 경로 해석 — 샌드박스를 쓰는 모든 실행 경로(MCP 샌드박스·아티팩트 실행·보고서 내보내기)의 공용 유틸.
 *
 * 종전에는 `mcp/sandbox-docker.ts` 안에 있었다. MCP 런타임이 add-on 으로 나가면서, Base 의 아티팩트 실행이
 * add-on 모듈을 가져오게 두지 않으려고 Base 유틸로 뽑았다 (2026-09-19). 동작은 동일하다.
 *
 * @module utils/docker-path
 */
import * as fs from 'fs';
import * as path from 'path';

let dockerCache: { key: string; value: string | null } | null = null;

/** PATH 또는 절대경로에서 docker 바이너리 탐색 (memoize). */
export function resolveDocker(dockerPath: string): string | null {
    if (dockerCache && dockerCache.key === dockerPath) return dockerCache.value;
    let resolved: string | null = null;
    try {
        if (dockerPath.includes('/')) {
            resolved = fs.existsSync(dockerPath) ? dockerPath : null;
        } else {
            const dirs = (process.env.PATH || '').split(path.delimiter);
            // Docker Desktop(macOS) 기본 경로 보강
            const extra = ['/usr/local/bin', '/opt/homebrew/bin'];
            for (const dir of [...dirs, ...extra]) {
                if (!dir) continue;
                const candidate = path.join(dir, dockerPath);
                if (fs.existsSync(candidate)) { resolved = candidate; break; }
            }
        }
    } catch {
        resolved = null;
    }
    dockerCache = { key: dockerPath, value: resolved };
    return resolved;
}

/** 테스트 전용 — 탐색 캐시 초기화 */
export function resetDockerPathCache(): void {
    dockerCache = null;
}
