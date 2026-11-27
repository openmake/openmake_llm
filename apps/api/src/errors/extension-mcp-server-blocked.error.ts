/**
 * ExtensionMcpServerBlockedError — 확장 MCP 서버 정책(§8-3)이 MCP 서버 등록을 거절했을 때. HTTP 403 `EXTENSION_MCP_SERVER_BLOCKED`.
 * 메시지는 코드로 시작한다 — add-on 라우트·확장 설치 리포트의 문자열 판정이 같은 접두어로 알아본다.
 * 메시지·감사에는 정규화한 식별(URL 은 query·userinfo 제외, 명령은 실행 파일 + 패키지)만 싣는다 — 인자·env 값은 싣지 않는다.
 * @module errors/extension-mcp-server-blocked.error
 */
import { AppError } from '../utils/error-handler';
import { EXTENSION_MCP_SERVER_BLOCKED_CODE } from '../config/extension-mcp-server-policy';

export { EXTENSION_MCP_SERVER_BLOCKED_CODE };

export interface ExtensionMcpServerBlockDetail {
    /** DENIED(차단 규칙 일치) · NOT_ALLOWED(허용 목록 밖) · POLICY_INVALID(저장 값 깨짐) · POLICY_UNAVAILABLE(조회 실패) · UNIDENTIFIED(식별 불가 — URL·명령을 해석하지 못함) */
    reason: 'DENIED' | 'NOT_ALLOWED' | 'POLICY_INVALID' | 'POLICY_UNAVAILABLE' | 'UNIDENTIFIED';
    /** 정책 층 */
    scope?: 'global' | 'organization';
    /** 일치한 규칙(DENIED) */
    rule?: unknown;
    /** 검사한 서버 식별(정규화) */
    server: string;
    /** 서버 이름(매니페스트 키 등) — 있으면 */
    name?: string;
}

const REASON_TEXT: Record<ExtensionMcpServerBlockDetail['reason'], string> = {
    DENIED: '차단 규칙에 걸린 MCP 서버입니다',
    NOT_ALLOWED: '허용 목록에 없는 MCP 서버입니다',
    POLICY_INVALID: 'MCP 서버 정책 값이 올바르지 않아 모든 MCP 서버를 막았습니다',
    POLICY_UNAVAILABLE: 'MCP 서버 정책을 확인하지 못해 막았습니다',
    UNIDENTIFIED: 'MCP 서버의 URL·명령을 식별하지 못해 막았습니다',
};

/** PURE: 사람이 읽는 거절 문구(오류 메시지·설치 리포트 경고 공용) */
export function describeMcpServerBlock(detail: ExtensionMcpServerBlockDetail): string {
    const rule = detail.rule !== undefined ? `, 규칙 ${JSON.stringify(detail.rule)}` : '';
    const scope = detail.scope ? `, ${detail.scope === 'global' ? '전역' : '조직'} 정책` : '';
    const name = detail.name ? `'${detail.name}' ` : '';
    return `${REASON_TEXT[detail.reason]} (${name}${detail.server}${scope}${rule})`;
}

export class ExtensionMcpServerBlockedError extends AppError {
    constructor(public readonly detail: ExtensionMcpServerBlockDetail) {
        super(`${EXTENSION_MCP_SERVER_BLOCKED_CODE}: ${describeMcpServerBlock(detail)}`, 403, true, EXTENSION_MCP_SERVER_BLOCKED_CODE);
        this.name = 'ExtensionMcpServerBlockedError';
    }
}
