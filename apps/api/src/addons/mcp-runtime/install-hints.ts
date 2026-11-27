/**
 * 설치 미리보기(M1b)용 MCP 서버 안내 — Base 포트 `runtime-ports/mcp-install-hints` 에 등록한다.
 *
 * 연결 전이라 서버 선언값(전송·주소)만 본다: 전송 퇴역·엔드포인트 이동은 MCP-3 규칙표(`transport-notices`)를 그대로 쓰고,
 * 원격(HTTP) 서버는 승인 뒤 OAuth 로그인이 필요할 수 있음을 알린다. 선언 확장은 연결해야 알 수 있어 여기서 내지 않는다.
 *
 * @module addons/mcp-runtime/install-hints
 */
import type { McpInstallHint, McpInstallHintInput } from '../../runtime-ports/mcp-install-hints';
import { computeTransportNotice } from './transport-notices';

export function mcpInstallHints(entry: McpInstallHintInput): McpInstallHint[] {
    const hints: McpInstallHint[] = [];
    const notice = computeTransportNotice({ transportType: entry.transportType, url: entry.url ?? null });
    if (notice) {
        hints.push({
            code: notice.code,
            detail: {
                replacementUrl: notice.replacementUrl,
                replacementVerified: notice.replacementVerified,
                sunsetDate: notice.sunsetDate,
                reauthRequired: notice.reauthRequired,
            },
        });
    }
    if (entry.transportType !== 'stdio') hints.push({ code: 'remote-auth-may-be-required' });
    return hints;
}
