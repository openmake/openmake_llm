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
    /** 다운로드 허용 파일명 패턴 — 경로 조작 차단 */
    FILE_PATTERN: /^OpenMake-[A-Za-z0-9.-]+\.dmg$/,
} as const;
