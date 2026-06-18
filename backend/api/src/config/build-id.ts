/**
 * Build ID 유틸 — 서버 빌드 식별자(gitHash) 단일 진입점.
 *
 * 소스: `backend/api/dist/build-info.json` 의 `gitHash` (deploy 시 자동 생성).
 * 부팅 시 1회 read 하여 메모리 캐시한다 — 매 요청마다 파일 read 금지.
 * 파일이 없거나(개발 중) 파싱 실패 시 `'dev'` 를 반환한다.
 *
 * 용도: index.html `<meta name="build-id">` 주입 + WS 연결 시 build_id 전송 →
 * 클라이언트가 자신의 build ID 와 비교해 구버전 탭 자동 reload.
 *
 * @module config/build-id
 */
import fs from 'node:fs';
import path from 'node:path';

const FALLBACK_BUILD_ID = 'dev';

// dist 출력 기준: 컴파일된 파일(dist/config/build-id.js)에서 dist/build-info.json 으로 한 단계 상위.
// health.controller.ts 의 build-info 경로 규칙과 동일.
const buildInfoPath = path.resolve(__dirname, '../build-info.json');

let _cachedBuildId: string | null = null;

/**
 * 서버 build ID(gitHash) 반환. 최초 호출 시 1회 파일 read 후 메모리 캐시.
 * @returns {string} gitHash 또는 `'dev'`
 */
export function getBuildId(): string {
    if (_cachedBuildId !== null) {
        return _cachedBuildId;
    }
    try {
        if (fs.existsSync(buildInfoPath)) {
            const raw = fs.readFileSync(buildInfoPath, 'utf-8');
            const parsed = JSON.parse(raw) as { gitHash?: unknown };
            if (typeof parsed.gitHash === 'string' && parsed.gitHash.trim() !== '') {
                _cachedBuildId = parsed.gitHash.trim();
                return _cachedBuildId;
            }
        }
    } catch {
        /* fallback below */
    }
    _cachedBuildId = FALLBACK_BUILD_ID;
    return _cachedBuildId;
}
