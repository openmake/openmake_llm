/**
 * CustomAgentRepository — custom_agents 의 draft 워크플로 전담 raw SQL 접근.
 *
 * 기존 agents/custom-builder.ts 와 별개:
 *   - custom-builder: 사용자가 UI 로 직접 생성 (status='active' 즉시)
 *   - 본 repository: Phase 3 git ingest 의 draft 워크플로 (status='draft' → 승인)
 *
 * @module data/repositories/custom-agent-repository
 */
import { BaseRepository, QueryParam } from './base-repository';
import { assertResourceOwnerOrAdmin } from '../../auth/ownership';

function slug(name: string): string {
    return name.toLowerCase()
        .replace(/[^a-z0-9가-힣]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'agent';
}

export type AgentStatus = 'draft' | 'active' | 'archived';

export interface CustomAgentRow {
    id: string;
    name: string;
    description: string | null;
    system_prompt: string;
    keywords: string[] | null;
    category: string | null;
    emoji: string | null;
    temperature: number | null;
    max_tokens: number | null;
    created_by: string | null;
    enabled: boolean;
    status: AgentStatus;
    manifest_meta: Record<string, unknown> | null;
    created_at: Date;
    updated_at: Date;
}

export interface InsertDraftInput {
    name: string;
    description: string;
    systemPrompt: string;
    category: string;
    emoji?: string;
    keywords?: string[];
    temperature?: number;
    maxTokens?: number;
    createdBy: string | null;
    manifestMeta: Record<string, unknown>;
}

export interface DraftListResult {
    drafts: CustomAgentRow[];
    total: number;
    limit: number;
    offset: number;
}

interface ActorContext { userId: string; userRole: string; }

export class CustomAgentRepository extends BaseRepository {
    async insertDraft(input: InsertDraftInput): Promise<CustomAgentRow> {
        const id = `custom-${slug(input.name)}-${Date.now()}`;
        const now = new Date();
        await this.query(
            `INSERT INTO custom_agents
               (id, name, description, system_prompt, keywords, category, emoji,
                temperature, max_tokens, created_by, enabled, status, manifest_meta,
                created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, 'draft', $12::jsonb, $13, $14)`,
            [
                id, input.name, input.description, input.systemPrompt,
                JSON.stringify(input.keywords ?? []), input.category, input.emoji ?? '🤖',
                input.temperature ?? null, input.maxTokens ?? null,
                input.createdBy, false,  // enabled=false 까지 draft 동안
                JSON.stringify(input.manifestMeta),
                now.toISOString(), now.toISOString(),
            ]
        );
        return {
            id,
            name: input.name,
            description: input.description,
            system_prompt: input.systemPrompt,
            keywords: input.keywords ?? null,
            category: input.category,
            emoji: input.emoji ?? '🤖',
            temperature: input.temperature ?? null,
            max_tokens: input.maxTokens ?? null,
            created_by: input.createdBy,
            enabled: false,
            status: 'draft',
            manifest_meta: input.manifestMeta,
            created_at: now,
            updated_at: now,
        };
    }

    async getById(id: string): Promise<CustomAgentRow | null> {
        const r = await this.query<CustomAgentRow>(
            `SELECT id, name, description, system_prompt, keywords, category, emoji,
                    temperature, max_tokens, created_by, enabled, status, manifest_meta,
                    created_at, updated_at
             FROM custom_agents WHERE id = $1`,
            [id]
        );
        return r.rows[0] ?? null;
    }

    async listDrafts(options: { userId?: string; target?: 'user' | 'system' | 'all'; limit?: number; offset?: number; }): Promise<DraftListResult> {
        const conditions: string[] = [`status = 'draft'`];
        const params: QueryParam[] = [];
        let paramIdx = 1;
        const target = options.target ?? 'user';
        if (target === 'user') {
            if (!options.userId) throw new Error('listDrafts: target=user 는 userId 필수');
            conditions.push(`created_by = $${paramIdx}`);
            params.push(options.userId);
            paramIdx += 1;
        } else if (target === 'system') {
            conditions.push(`created_by IS NULL`);
        }
        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const limit = Math.min(options.limit ?? 50, 100);
        const offset = Math.max(0, options.offset ?? 0);
        const countR = await this.query<{ total: string }>(
            `SELECT COUNT(*) AS total FROM custom_agents ${whereClause}`,
            params
        );
        const dataParams: QueryParam[] = [...params, limit, offset];
        const dataR = await this.query<CustomAgentRow>(
            `SELECT id, name, description, system_prompt, keywords, category, emoji,
                    temperature, max_tokens, created_by, enabled, status, manifest_meta,
                    created_at, updated_at
             FROM custom_agents ${whereClause}
             ORDER BY created_at DESC, id ASC
             LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
            dataParams
        );
        return {
            drafts: dataR.rows,
            total: parseInt(countR.rows[0]?.total ?? '0', 10),
            limit,
            offset,
        };
    }

    async updateStatus(id: string, status: AgentStatus, actor?: ActorContext): Promise<CustomAgentRow | null> {
        const existing = await this.getById(id);
        if (!existing) return null;
        if (actor) {
            if (existing.created_by) {
                assertResourceOwnerOrAdmin(existing.created_by, actor.userId, actor.userRole);
            } else if (actor.userRole !== 'admin') {
                throw new Error('ADMIN_REQUIRED: 시스템 agent status 변경은 admin 만 가능');
            }
        }
        const enabled = status === 'active';
        await this.query(
            `UPDATE custom_agents SET status=$1, enabled=$2, updated_at=$3 WHERE id=$4`,
            [status, enabled, new Date().toISOString(), id]
        );
        return this.getById(id);
    }

    async countDraftsForUser(userId: string): Promise<number> {
        const r = await this.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM custom_agents WHERE created_by=$1 AND status='draft'`,
            [userId]
        );
        return parseInt(r.rows[0]?.count ?? '0', 10);
    }
}
