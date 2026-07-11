/**
 * 고위험 MCP 서버 도구 역할 게이팅 — ChatService 에서 분리 (파일 크기 가드).
 *
 * 외부 공개 인스턴스에서 게스트·저권한 사용자에게 위험 도구(임의 코드 실행 등)가
 * 과노출되는 것을 차단한다. env `MCP_RESTRICTED_SERVERS`("서버명:역할,..")로 정책 외부화.
 *
 * @module services/chat-service/tool-restrictions
 */
import { type ToolDefinition } from '../../llm';

/** 역할 레벨 (게스트<일반<관리자). */
function roleLevel(role?: string): number {
    return role === 'admin' ? 2 : role === 'user' ? 1 : 0;
}

/**
 * 고위험 MCP 서버별 최소 역할 파싱 — env `MCP_RESTRICTED_SERVERS` ("서버명:역할,..").
 * 기본: Python REPL(임의코드)=admin, Playwright Browser=user. (open registration 이라
 * authenticated 는 약해 arbitrary code 는 admin 기본.)
 */
function parseRestrictedServers(): Map<string, number> {
    const raw = process.env.MCP_RESTRICTED_SERVERS ?? 'Python REPL:admin,Playwright Browser:user';
    const m = new Map<string, number>();
    for (const part of raw.split(',')) {
        const idx = part.lastIndexOf(':');
        if (idx <= 0) continue;
        const name = part.slice(0, idx).trim();
        const role = part.slice(idx + 1).trim();
        if (name) m.set(name, roleLevel(role));
    }
    return m;
}

/**
 * 고위험 서버 도구(네임스페이스 "서버명::도구")를 역할 미달 사용자에게서 제거.
 * 외부 공개 인스턴스에서 게스트·저권한 사용자의 위험도구 과노출 차단.
 */
export function filterRestrictedTools(tools: ToolDefinition[], role?: string): ToolDefinition[] {
    const restricted = parseRestrictedServers();
    if (restricted.size === 0) return tools;
    const userLevel = roleLevel(role);
    return tools.filter((t) => {
        for (const [serverName, minLevel] of restricted) {
            if (t.function.name.startsWith(`${serverName}::`) && userLevel < minLevel) return false;
        }
        return true;
    });
}
