/**
 * 고위험 MCP 서버 도구의 역할 게이트 — 노출(filterRestrictedTools)과 실행(ToolRouter.executeTool)
 * 이 같은 정책을 본다. env `MCP_RESTRICTED_SERVERS`("서버명:역할,..") 로 외부화.
 *
 * 기본: Python REPL(임의코드)=admin, Playwright Browser=user. (open registration 이라
 * authenticated 는 약해 arbitrary code 는 admin 기본.)
 *
 * 2026-09-02 보안 리뷰 B7-01: 종전엔 노출 시점에만 걸러 프롬프트 인젝션·REST 직접 호출로
 * 이름을 지목하면 실행됐다. 서킷 차단과 같은 2차 방어를 실행 진입점에 둔다.
 */
import { isAdminRole } from '../data/user-manager';
import { MCP_NAMESPACE_SEPARATOR } from './types';

export const DEFAULT_RESTRICTED_SERVERS = 'Python REPL:admin,Playwright Browser:user';

/** 역할 레벨 (게스트<일반<관리자). */
export function roleLevel(role?: string): number {
    return isAdminRole(role) ? 2 : role === 'user' ? 1 : 0;
}

/** 고위험 MCP 서버별 최소 역할 파싱. */
export function parseRestrictedServers(): Map<string, number> {
    const raw = process.env.MCP_RESTRICTED_SERVERS ?? DEFAULT_RESTRICTED_SERVERS;
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

/** 네임스페이스 도구 이름("서버명::도구")이 역할 미달로 제한되면 true. */
export function isToolRestrictedForRole(toolName: string, role?: string): boolean {
    if (!toolName.includes(MCP_NAMESPACE_SEPARATOR)) return false;
    const restricted = parseRestrictedServers();
    if (restricted.size === 0) return false;
    const userLevel = roleLevel(role);
    for (const [serverName, minLevel] of restricted) {
        if (toolName.startsWith(`${serverName}${MCP_NAMESPACE_SEPARATOR}`) && userLevel < minLevel) return true;
    }
    return false;
}
