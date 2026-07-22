/**
 * @module config/artifact-viewer
 * @description Docker nginx 별도-오리진 엄격 CSP 아티팩트 뷰어 설정 (C안).
 *
 * publish 된 artifact 를 self-contained HTML 로 export → 볼륨에 기록 → 별도 오리진
 * nginx 컨테이너가 strict CSP 로 서빙. 접근제어는 nginx auth_request → 백엔드 토큰검증.
 *
 * 외부화 (No-Hardcoding L1): 모든 값 env override.
 */
import * as path from 'path';

/** 뷰어 공개 base URL (별도 오리진). 로컬: http://localhost:8088, 외부: Funnel :8443 URL. */
const ORIGIN = process.env.ARTIFACT_VIEWER_ORIGIN || 'http://localhost:8088';

export const ARTIFACT_VIEWER = {
    /** 기능 게이트 — 미설정 시 off (publish 시 뷰어 export 생략, in-app 만). */
    enabled: process.env.ARTIFACT_VIEWER_ENABLED === 'true',

    /** 뷰어 공개 origin (CSP host 소스 + 공유 URL 조립에 사용). */
    origin: ORIGIN,

    /**
     * 백엔드(PM2 호스트)가 self-contained HTML 을 기록하는 디렉토리.
     * nginx 컨테이너가 이 경로를 read-only bind mount 로 서빙.
     * 구조: {dataDir}/a/{pubId}/index.html , {dataDir}/vendor/*.js
     */
    dataDir: process.env.ARTIFACT_VIEWER_DATA_DIR
        || path.resolve(process.cwd(), 'data/artifact-viewer'),

    /**
     * 뷰어 접근토큰(authenticated/private) 서명 키 — HMAC-SHA256.
     * link visibility 는 share_token(DB) 사용, 그 외는 이 키로 서명한 단기 토큰.
     * 미설정 시 JWT_SECRET 재사용(별도 운영 키 권장).
     */
    signingKey: process.env.ARTIFACT_VIEWER_SIGNING_KEY || process.env.JWT_SECRET || 'dev-viewer-key',

    /** authenticated/private 접근토큰 TTL (초). 갤러리에서 열 때마다 새로 발급. */
    accessTokenTtlSec: parseInt(process.env.ARTIFACT_VIEWER_TOKEN_TTL_SEC || '3600', 10),

    /** react(JSX) 런타임 변환은 babel eval 필요 → 해당 종류만 'unsafe-eval' 완화. */
    reactNeedsUnsafeEval: true,

    /**
     * 신뢰 CDN 화이트리스트 (안 B) — script/style/img/font 소스로만 허용.
     * connect-src 는 여전히 'none' (fetch/XHR/WebSocket 데이터 유출 차단) — 핵심 보호 유지.
     * Three.js/D3/Chart 등 외부 라이브러리에 의존하는 아티팩트가 공유 뷰어에서도 렌더되도록.
     * space 구분 env override.
     */
    trustedCdns: (process.env.ARTIFACT_VIEWER_TRUSTED_CDNS
        || 'https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net')
        .split(/\s+/).filter(Boolean),
} as const;

/** publish 한 artifact 의 뷰어 디렉토리 절대경로. */
export function viewerArtifactDir(pubId: string): string {
    return `${ARTIFACT_VIEWER.dataDir}/a/${pubId}`;
}
