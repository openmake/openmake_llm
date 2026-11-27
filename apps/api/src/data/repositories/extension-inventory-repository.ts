/**
 * 관리자 확장 현황 저장소(마켓플레이스 남은 개발계획 v3.7 M3) — 사용자별 설치 확장(user_extensions) 읽기 전용 조회.
 *
 * Base 표(user_extensions·users·addon_installations `ext:<id>`·user_agents)만 SQL 로 읽는다. 스킬·MCP 서버 구성요소는
 * add-on 소유 표라 서비스(services/extensions/inventory)가 구성요소 저장 연산(getComponentStore)으로 붙인다.
 * 관리자 전용 라우트에서만 부른다 — 소유자 정보(username·email)가 실린다.
 *
 * @module data/repositories/extension-inventory-repository
 */
import { BaseRepository, type QueryParam } from './base-repository';

export const EXTENSION_INVENTORY_STATUSES = ['active', 'removed'] as const;
export type ExtensionInventoryStatus = typeof EXTENSION_INVENTORY_STATUSES[number];

export interface ExtensionInventoryFilter {
    /** 이름·원본 URL·소유자 username·email 부분 일치(대소문자 무시) */
    q?: string;
    userId?: string;
    /** 원본 URL 부분 일치 */
    source?: string;
    status?: ExtensionInventoryStatus;
}

export interface ExtensionInventoryRow {
    id: string;
    user_id: string;
    username: string | null;
    email: string | null;
    name: string;
    version: string;
    source_url: string;
    source_ref: string;
    source_path: string;
    source_hash: string;
    tracking_ref: string | null;
    status: ExtensionInventoryStatus;
    visibility: string;
    org_id: string | null;
    permission_state: string;
    /** addon_installations 의 `ext:<id>` 상태 — 기록이 없으면 null */
    install_state: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface ExtensionSourceSummaryRow {
    source_url: string;
    installs: number;
    users: number;
    last_installed_at: Date;
}

export interface ExtensionAgentRow { id: string; extension_id: string; name: string; status: string }

/** 커서 = 마지막 행의 (created_at, id) — 내림차순 keyset */
export interface InventoryCursor { createdAt: string; id: string }

export function encodeInventoryCursor(c: InventoryCursor): string {
    return Buffer.from(`${c.createdAt}|${c.id}`, 'utf8').toString('base64url');
}

/** 깨진 커서는 null — 라우트가 400 으로 돌린다 */
export function decodeInventoryCursor(raw: string): InventoryCursor | null {
    let text: string;
    try { text = Buffer.from(raw, 'base64url').toString('utf8'); } catch { return null; }
    const sep = text.indexOf('|');
    if (sep <= 0) return null;
    const createdAt = text.slice(0, sep);
    const id = text.slice(sep + 1);
    if (!id || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
}

function escapeLike(v: string): string {
    return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** 필터 → WHERE 절(파라미터 번호는 `start` 부터) */
function filterClause(f: ExtensionInventoryFilter, start: number): { sql: string; params: QueryParam[] } {
    const conds: string[] = [];
    const params: QueryParam[] = [];
    /** 값을 넣고 그 값의 placeholder 를 돌려준다(번호는 push 뒤 길이 기준 — start + 길이 - 1) */
    const bind = (v: QueryParam): string => { params.push(v); return `$${start + params.length - 1}`; };
    if (f.status) conds.push(`e.status = ${bind(f.status)}`);
    if (f.userId) conds.push(`e.user_id = ${bind(f.userId)}`);
    if (f.source) conds.push(`e.source_url ILIKE ${bind(`%${escapeLike(f.source)}%`)}`);
    if (f.q) {
        const p = bind(`%${escapeLike(f.q)}%`);
        conds.push(`(e.name ILIKE ${p} OR e.source_url ILIKE ${p} OR u.username ILIKE ${p} OR u.email ILIKE ${p})`);
    }
    return { sql: conds.length ? conds.join(' AND ') : 'TRUE', params };
}

export class ExtensionInventoryRepository extends BaseRepository {
    async listPage(filter: ExtensionInventoryFilter, limit: number, cursor: InventoryCursor | null): Promise<ExtensionInventoryRow[]> {
        const params: QueryParam[] = [];
        let cursorSql = 'TRUE';
        if (cursor) {
            params.push(cursor.createdAt, cursor.id);
            cursorSql = '(e.created_at, e.id) < ($1::timestamptz, $2)';
        }
        const where = filterClause(filter, params.length + 1);
        params.push(...where.params, limit);
        const r = await this.query<ExtensionInventoryRow>(
            `SELECT e.id, e.user_id, u.username, u.email, e.name, e.version, e.source_url, e.source_ref, e.source_path,
                    e.source_hash, e.tracking_ref, e.status, e.visibility, e.org_id, e.permission_state,
                    a.state AS install_state, e.created_at, e.updated_at
               FROM user_extensions e
               LEFT JOIN users u ON u.id = e.user_id
               LEFT JOIN addon_installations a ON a.addon_id = 'ext:' || e.id
              WHERE ${cursorSql} AND ${where.sql}
              ORDER BY e.created_at DESC, e.id DESC
              LIMIT $${params.length}`,
            params,
        );
        return r.rows;
    }

    /** 원본별 집계(같은 필터) — 설치 수 내림차순 */
    async summarizeSources(filter: ExtensionInventoryFilter, max: number): Promise<ExtensionSourceSummaryRow[]> {
        const where = filterClause(filter, 1);
        const r = await this.query<ExtensionSourceSummaryRow>(
            `SELECT e.source_url, COUNT(*)::int AS installs, COUNT(DISTINCT e.user_id)::int AS users,
                    MAX(e.created_at) AS last_installed_at
               FROM user_extensions e
               LEFT JOIN users u ON u.id = e.user_id
              WHERE ${where.sql}
              GROUP BY e.source_url
              ORDER BY installs DESC, e.source_url
              LIMIT $${where.params.length + 1}`,
            [...where.params, max],
        );
        return r.rows;
    }

    /** 정책 미리보기 대상 — 활성 설치 전부(상한 max+1 로 잘림 판정) */
    async listActiveForPreview(max: number): Promise<ExtensionInventoryRow[]> {
        return this.listPage({ status: 'active' }, max + 1, null);
    }

    async listAgentsByExtensions(extensionIds: readonly string[]): Promise<ExtensionAgentRow[]> {
        if (extensionIds.length === 0) return [];
        const r = await this.query<ExtensionAgentRow>(
            `SELECT id, extension_id, name,
                    CASE WHEN NOT is_active THEN 'archived' WHEN approval_status = 'pending' THEN 'draft' ELSE 'active' END AS status
               FROM user_agents WHERE extension_id = ANY($1::text[]) ORDER BY name`,
            [extensionIds as string[]],
        );
        return r.rows;
    }
}
