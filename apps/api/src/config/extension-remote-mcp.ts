/**
 * 확장 번들 원격 MCP 관리 등록(P8, 마켓플레이스 계획 v3.7 §8) 플래그·코드.
 *
 * `EXTENSION_REMOTE_MCP_ENABLED`(기본 OFF, system_settings 실시간). 꺼져 있으면 종전 그대로 — 확장 번들의 원격
 * (streamable-http) MCP 서버는 `network:internet` 권한이 있으면(또는 매니페스트 미동봉이면) URL 검사 없이 draft 로
 * 저장되고, 승인하면 곧바로 연결을 시도한다.
 *
 * 켜면(관리 등록):
 *  - 설치: 번들이 선언한 URL 을 https·SSRF 가드로 검사하고(사설·루프백·메타데이터 주소는 설치에서 제외),
 *    선언값을 `manifest_meta.remoteRegistration.declaredUrl` 로 고정한다(사용자가 바꾸는 경로는 없다 — 헤더 주입 미지원 규약 유지).
 *  - 승인: 저장된 URL 이 선언값과 같은지, SSRF·정책을 다시 확인한 뒤 활성화하고, 연결은 OAuth 로그인 뒤로 미룬다(`oauthRequired`).
 *  - 연결: 승인 전(draft·archived) 서버는 수동 연결·OAuth 시작이 모두 거절된다 — 승인 전 연결 0.
 *
 * MCP 서버 매처 정책(§8-3)은 `services/extensions/remote-mcp-registration` 의 일반 훅(`setExtensionMcpServerPolicyHook`)에
 * 꽂는다 — 설치·승인 두 지점이 이미 그 훅을 부른다.
 *
 * @module config/extension-remote-mcp
 */
import { getConfig } from './env';

export const EXTENSION_REMOTE_MCP_FLAG = 'EXTENSION_REMOTE_MCP_ENABLED';

export function extensionRemoteMcpEnabled(): boolean {
    return getConfig().extensionRemoteMcpEnabled;
}

/** `manifest_meta` 안의 관리 등록 기록 키 */
export const REMOTE_MCP_REGISTRATION_META_KEY = 'remoteRegistration';

/** 경고·응답 코드 — 설치 경고는 `<코드>: 설명` 형식(다른 설치 경고와 같다) */
export const EXTENSION_REMOTE_MCP_CODES = {
    /** 선언 URL 이 https 가 아니다(평문 원격 MCP 는 OAuth 토큰이 그대로 노출된다) */
    URL_INSECURE: 'MCP_REMOTE_URL_INSECURE',
    /** SSRF 가드 차단(사설·루프백·링크로컬·메타데이터 주소) */
    URL_BLOCKED: 'MCP_REMOTE_URL_BLOCKED',
    /** 승인 시점에 호스트를 확인하지 못했다(설치 때는 경고만 남기고 승인에서 다시 본다) */
    URL_UNRESOLVED: 'MCP_REMOTE_URL_UNRESOLVED',
    /** 저장된 URL 이 번들 선언값과 다르다 */
    URL_MISMATCH: 'MCP_REMOTE_URL_MISMATCH',
    /** MCP 서버 정책 훅(§8-3)이 거절했다 */
    POLICY_BLOCKED: 'MCP_SERVER_POLICY_BLOCKED',
    /** 정책 훅이 실패했다(켜진 정책을 확인하지 못하면 거절 — fail-closed) */
    POLICY_UNAVAILABLE: 'MCP_SERVER_POLICY_UNAVAILABLE',
    /** 승인 전 서버의 연결·OAuth 시작 */
    NOT_APPROVED: 'MCP_SERVER_NOT_APPROVED',
} as const;
