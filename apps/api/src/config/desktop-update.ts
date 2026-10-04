/**
 * Desktop 앱 업데이트 배포 설정 (No-Hardcoding L1).
 *
 * 데스크톱 앱이 GET /api/desktop/latest 로 최신 버전을 확인하고
 * /api/desktop/download/:file 로 dmg 를 받는다. 산출물은 git 에 넣지 않고
 * 서버 디렉토리(DESKTOP_UPDATE_DIR)에 두며, scripts/publish-desktop.sh 가
 * dmg 복사 + latest.json(버전·파일명·sha256) 생성을 담당한다.
 *
 * @module config/desktop-update
 */
import * as path from 'path';

export const DESKTOP_UPDATE = {
    /** dmg + latest.json 보관 디렉토리 */
    DIR: process.env.DESKTOP_UPDATE_DIR || path.join(process.cwd(), 'data', 'desktop-updates'),
    /** 다운로드 허용 파일명 패턴 — 경로 조작 차단. macOS 는 네이티브 컴패니언 dmg 만 (구 Electron dmg 거부, 2026-09-11) */
    FILE_PATTERN: /^OpenMake-Companion-[A-Za-z0-9.-]+\.dmg$/,
    /** Windows 설치 파일 이름 패턴(Companion P4) — `OpenMake-Companion-Setup-<버전>.exe` 만 */
    WINDOWS_FILE_PATTERN: /^OpenMake-Companion-Setup-[A-Za-z0-9.-]+\.exe$/,
} as const;

/** 웹(Next) 포트 기본값 — scripts/resolve-ports.cjs 와 같은 값 */
const DEFAULT_WEB_PORT = 3000;

/**
 * PURE: 이 서버의 API 포트와 웹 포트 — 데스크톱 앱이 `GET /api/desktop/config` 로 물어, 사용자가 넣은 주소 하나에서
 * 연결 주소와 웹 주소를 정한다(@openmake/local-bridge-core 의 endpoints). 앱이 포트를 코드에 박아 두지 않게 하는 근거 값이다.
 * 웹 포트 규칙은 scripts/resolve-ports.cjs 와 같다: OMK_WEB_PORT → OMK_APP_URL 끝의 포트 → 3000.
 */
export function resolveDesktopPorts(apiPort: number, env: Record<string, string | undefined> = process.env): { apiPort: number; webPort: number } {
    const explicit = parseInt(env.OMK_WEB_PORT || '', 10);
    const fromUrl = /:(\d+)\/?$/.exec((env.OMK_APP_URL || '').trim());
    const webPort = explicit > 0 ? explicit : fromUrl ? parseInt(fromUrl[1], 10) : DEFAULT_WEB_PORT;
    return { apiPort, webPort };
}
