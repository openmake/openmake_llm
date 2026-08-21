/**
 * MCP 서버 visibility / ownership 권한 검사 pure functions.
 *
 * 모든 함수는 외부 의존 없는 순수 함수 — TDD 가능.
 *
 * 시맨틱 (P6-D2~D4):
 *   - global       : admin 등록, 모두 view, owner=admin → admin 만 delete
 *   - user_private : 본인만 view + delete + start/stop, admin 은 모든 작업 가능
 *   - user_shared  : 모두 view, owner + admin 만 delete/start/stop
 *
 * 사용자 등록 요건 (P6-D3): catalog_template_id 필수 — 임의 stdio command 차단.
 *
 */
import type { UserMcpServerRow } from '../data/repositories/mcp-catalog-repository';
import type { McpVisibility } from '../schemas/mcp-catalog.schema';
import { isAdminRole } from '../data/user-manager';

export interface Actor {
    id: string;
    role: 'user' | 'admin' | string;
}

export interface RegisterInput {
    visibility: McpVisibility;
    catalog_template_id?: string;
}

export type CheckResult = { allowed: true } | { allowed: false; reason: string };

export function canRegisterServer(actor: Actor, input: RegisterInput): CheckResult {
    if (input.visibility === 'global') {
        if (!isAdminRole(actor.role)) {
            return { allowed: false, reason: 'global 서버는 admin 만 등록할 수 있습니다' };
        }
        return { allowed: true };
    }
    if (!input.catalog_template_id) {
        return { allowed: false, reason: '사용자 등록은 catalog_template_id 필수 (임의 stdio command 금지)' };
    }
    return { allowed: true };
}

export function canViewServer(actor: Actor, server: UserMcpServerRow): boolean {
    if (server.visibility === 'global' || server.visibility === 'user_shared') return true;
    if (isAdminRole(actor.role)) return true;
    return server.user_id === actor.id;
}

export function canDeleteServer(actor: Actor, server: UserMcpServerRow): boolean {
    if (isAdminRole(actor.role)) return true;
    return server.user_id === actor.id;
}

export function canStartStopServer(actor: Actor, server: UserMcpServerRow): boolean {
    if (isAdminRole(actor.role)) return true;
    return server.user_id === actor.id;
}

/**
 * env(자격증명) 교체 권한 — 소유자 + admin.
 * user_shared 서버라도 공유 대상자는 값을 바꿀 수 없다(조회 권한과 분리).
 */
export function canUpdateServerEnv(actor: Actor, server: UserMcpServerRow): boolean {
    if (isAdminRole(actor.role)) return true;
    return server.user_id === actor.id;
}
