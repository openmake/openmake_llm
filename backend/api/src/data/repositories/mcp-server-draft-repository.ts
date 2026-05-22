/**
 * MCP server draft 저장소 (Phase 4).
 *
 * 보안 보장:
 *   - insertDraft 는 항상 status='draft', enabled=false, visibility='user_private' 강제
 *   - approve 는 status='draft' → 'active' (enableImmediately 기본 true)
 *   - reject 는 status='draft' → 'archived'
 *   - 본인 row 또는 admin 만 approve/reject 가능
 *
 * 인덱스 활용:
 *   - listDrafts: idx_mcp_servers_draft_user (user_id, created_at DESC) WHERE status='draft'
 *   - findRecentDraftByHash: idx_mcp_servers_git_source_hash (manifest_meta->>'promptHash')
 *
 * @module data/repositories/mcp-server-draft-repository
 */
import * as crypto from 'crypto';
import { BaseRepository } from './base-repository';

export interface InsertDraftInput {
    name: string;
    transportType: 'stdio' | 'sse' | 'streamable-http';
    command?: string | null;
    args?: string[] | null;
    env?: Record<string, string> | null;
    url?: string | null;
    createdBy: string;
    manifestMeta: Record<string, unknown>;
}

export interface ApproveInput {
    id: string;
    userId: string;
    isAdmin: boolean;
    envOverrides?: Record<string, string>;
    enableImmediately?: boolean;
}

export interface McpServerRow {
    id: string;
    name: string;
    transport_type: 'stdio' | 'sse' | 'streamable-http';
    command: string | null;
    args: string[] | null;
    env: Record<string, string> | null;
    url: string | null;
    enabled: boolean;
    visibility: 'global' | 'user_private' | 'user_shared';
    user_id: string | null;
    status: 'draft' | 'active' | 'archived';
    manifest_meta: Record<string, unknown> | null;
    catalog_template_id: string | null;
    auto_spawn: boolean;
    created_at: Date;
    updated_at: Date;
}

export class McpServerDraftRepository extends BaseRepository {
    async insertDraft(input: InsertDraftInput): Promise<McpServerRow> {
        const id = `mcp-${crypto.randomUUID().slice(0, 8)}-${Date.now().toString(36)}`;
        const r = await this.query<McpServerRow>(
            `INSERT INTO mcp_servers (
                id, name, transport_type, command, args, env, url,
                enabled, visibility, user_id, status, manifest_meta,
                catalog_template_id, auto_spawn, created_at, updated_at
             ) VALUES (
                $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7,
                FALSE, 'user_private', $8, 'draft', $9::jsonb,
                NULL, FALSE, NOW(), NOW()
             ) RETURNING *`,
            [
                id,
                input.name,
                input.transportType,
                input.command ?? null,
                JSON.stringify(input.args ?? null),
                JSON.stringify(input.env ?? null),
                input.url ?? null,
                input.createdBy,
                JSON.stringify(input.manifestMeta),
            ]
        );
        return r.rows[0];
    }

    async getById(id: string): Promise<McpServerRow | null> {
        const r = await this.query<McpServerRow>(
            `SELECT * FROM mcp_servers WHERE id=$1 LIMIT 1`,
            [id]
        );
        return r.rows[0] ?? null;
    }

    async listDrafts(userId: string, limit: number = 50): Promise<McpServerRow[]> {
        const r = await this.query<McpServerRow>(
            `SELECT * FROM mcp_servers
              WHERE user_id=$1 AND status='draft'
              ORDER BY created_at DESC
              LIMIT $2`,
            [userId, limit]
        );
        return r.rows;
    }

    async countDraftsForUser(userId: string): Promise<number> {
        const r = await this.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM mcp_servers
              WHERE user_id=$1 AND status='draft'`,
            [userId]
        );
        return parseInt(r.rows[0].count, 10);
    }

    /**
     * draft → active 전이.
     * 본인 row 또는 admin 만 가능. envOverrides 가 있으면 기존 env 와 merge.
     */
    async approve(input: ApproveInput): Promise<McpServerRow | null> {
        const existing = await this.getById(input.id);
        if (!existing) return null;
        if (existing.status !== 'draft') return null;
        if (existing.user_id !== input.userId && !input.isAdmin) return null;

        const mergedEnv = input.envOverrides
            ? { ...(existing.env || {}), ...input.envOverrides }
            : existing.env;
        const shouldEnable = input.enableImmediately !== false;

        const r = await this.query<McpServerRow>(
            `UPDATE mcp_servers
                SET status='active',
                    enabled=$1,
                    env=$2::jsonb,
                    updated_at=NOW()
              WHERE id=$3
              RETURNING *`,
            [shouldEnable, JSON.stringify(mergedEnv), input.id]
        );
        return r.rows[0] ?? null;
    }

    /**
     * draft → archived 전이 (소프트 거부).
     */
    async reject(id: string, userId: string, isAdmin: boolean): Promise<McpServerRow | null> {
        const existing = await this.getById(id);
        if (!existing) return null;
        if (existing.status !== 'draft') return null;
        if (existing.user_id !== userId && !isAdmin) return null;

        const r = await this.query<McpServerRow>(
            `UPDATE mcp_servers
                SET status='archived', updated_at=NOW()
              WHERE id=$1
              RETURNING *`,
            [id]
        );
        return r.rows[0] ?? null;
    }

    /**
     * windowHours 내 동일 promptHash 의 draft 가 있으면 그 row 반환 (dedupe).
     */
    async findRecentDraftByHash(
        userId: string,
        promptHash: string,
        windowHours: number,
    ): Promise<McpServerRow | null> {
        const r = await this.query<McpServerRow>(
            `SELECT * FROM mcp_servers
              WHERE user_id=$1 AND status='draft'
                AND manifest_meta->>'promptHash' = $2
                AND created_at > NOW() - ($3 || ' hours')::INTERVAL
              ORDER BY created_at DESC
              LIMIT 1`,
            [userId, promptHash, windowHours.toString()]
        );
        return r.rows[0] ?? null;
    }
}
