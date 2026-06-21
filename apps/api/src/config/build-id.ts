/**
 * Build Info 유틸 — 서버 빌드 메타(gitHash/buildTime/gitDate) 단일 진입점.
 *
 * 소스: `apps/api/dist/build-info.json` (deploy 시 build-info 스크립트가 자동 생성).
 * 부팅 시 1회 read 하여 메모리 캐시한다 — 매 요청마다 파일 read 금지.
 * 파일이 없거나(개발 중·ts-node) 파싱 실패 시 fallback(gitHash `'dev'`)을 반환한다.
 *
 * build ID handshake(index.html `<meta name="build-id">` 주입 + WS 연결 시 build_id 전송)와
 * `/health` 응답이 **같은 캐시를 공유**한다 — 별도 read 로 gitHash sentinel 이 갈리지 않게 단일화.
 *
 * @module config/build-id
 */
import fs from 'node:fs';
import path from 'node:path';

export interface BuildInfo {
    buildTime: string;
    gitHash: string;
    gitDate: string;
}

const FALLBACK_BUILD_ID = 'dev';
const FALLBACK_BUILD_INFO: BuildInfo = {
    buildTime: 'unknown',
    gitHash: FALLBACK_BUILD_ID,
    gitDate: 'unknown',
};

// dist 출력 기준: 컴파일된 파일(dist/config/build-id.js)에서 dist/build-info.json 으로 한 단계 상위.
const buildInfoPath = path.resolve(__dirname, '../build-info.json');

let _cached: BuildInfo | null = null;

/**
 * 서버 build-info 전체 반환. 최초 호출 시 1회 파일 read 후 메모리 캐시.
 * @returns {BuildInfo} { buildTime, gitHash, gitDate } — 누락/파싱 실패 시 fallback
 */
export function getBuildInfo(): BuildInfo {
    if (_cached !== null) {
        return _cached;
    }
    try {
        if (fs.existsSync(buildInfoPath)) {
            const parsed = JSON.parse(fs.readFileSync(buildInfoPath, 'utf-8')) as Partial<BuildInfo>;
            _cached = {
                buildTime: typeof parsed.buildTime === 'string' ? parsed.buildTime : FALLBACK_BUILD_INFO.buildTime,
                gitHash: (typeof parsed.gitHash === 'string' && parsed.gitHash.trim() !== '')
                    ? parsed.gitHash.trim()
                    : FALLBACK_BUILD_ID,
                gitDate: typeof parsed.gitDate === 'string' ? parsed.gitDate : FALLBACK_BUILD_INFO.gitDate,
            };
            return _cached;
        }
    } catch {
        /* fallback below */
    }
    _cached = FALLBACK_BUILD_INFO;
    return _cached;
}

/**
 * 서버 build ID(gitHash) 반환 — getBuildInfo().gitHash (없으면 `'dev'`).
 * @returns {string} gitHash 또는 `'dev'`
 */
export function getBuildId(): string {
    return getBuildInfo().gitHash;
}
