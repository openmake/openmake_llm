/**
 * 조직·멤버 저장소 (Control Plane 기초, 127).
 *
 * @module data/repositories/organization-repository
 */
import { BaseRepository } from './base-repository';

export type OrgRole = 'owner' | 'admin' | 'member';

export interface Organization {
    id: string;
    name: string;
    slug: string;
    monthly_token_budget: string | number | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface OrgMember {
    org_id: string;
    user_id: string;
    role: OrgRole;
    created_at: string;
}

export class OrganizationRepository extends BaseRepository {
    async create(id: string, name: string, slug: string, createdBy: string | null, monthlyTokenBudget: number | null): Promise<Organization> {
        const r = await this.query<Organization>(
            `INSERT INTO organizations (id, name, slug, created_by, monthly_token_budget) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [id, name, slug, createdBy, monthlyTokenBudget],
        );
        return r.rows[0];
    }

    async list(limit = 200): Promise<Organization[]> {
        const r = await this.query<Organization>('SELECT * FROM organizations ORDER BY created_at DESC LIMIT $1', [limit]);
        return r.rows;
    }

    async get(id: string): Promise<Organization | undefined> {
        const r = await this.query<Organization>('SELECT * FROM organizations WHERE id = $1', [id]);
        return r.rows[0];
    }

    async update(id: string, patch: { name?: string; monthlyTokenBudget?: number | null }): Promise<Organization | undefined> {
        const sets: string[] = ['updated_at = NOW()'];
        const params: Array<string | number | null> = [];
        if (patch.name !== undefined) { params.push(patch.name); sets.push(`name = $${params.length}`); }
        if (patch.monthlyTokenBudget !== undefined) { params.push(patch.monthlyTokenBudget); sets.push(`monthly_token_budget = $${params.length}`); }
        params.push(id);
        const r = await this.query<Organization>(`UPDATE organizations SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
        return r.rows[0];
    }

    async remove(id: string): Promise<boolean> {
        const r = await this.query('DELETE FROM organizations WHERE id = $1', [id]);
        return (r.rowCount ?? 0) > 0;
    }

    async listMembers(orgId: string): Promise<OrgMember[]> {
        const r = await this.query<OrgMember>('SELECT * FROM organization_members WHERE org_id = $1 ORDER BY created_at ASC', [orgId]);
        return r.rows;
    }

    async upsertMember(orgId: string, userId: string, role: OrgRole): Promise<OrgMember> {
        const r = await this.query<OrgMember>(
            `INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, $3)
             ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role RETURNING *`,
            [orgId, userId, role],
        );
        return r.rows[0];
    }

    async removeMember(orgId: string, userId: string): Promise<boolean> {
        const r = await this.query('DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
        return (r.rowCount ?? 0) > 0;
    }

    /** 사용자가 속한 조직 중 월 예산이 있는 것들과 그 멤버 id — 쿼터 검사 재료(예산 없는 조직은 제외). */
    async listBudgetedOrgsForUser(userId: string): Promise<Array<{ orgId: string; budget: number; memberIds: string[] }>> {
        const r = await this.query<{ org_id: string; monthly_token_budget: string; member_ids: string[] }>(
            `SELECT o.id AS org_id, o.monthly_token_budget,
                    ARRAY(SELECT m2.user_id FROM organization_members m2 WHERE m2.org_id = o.id) AS member_ids
             FROM organizations o
             JOIN organization_members m ON m.org_id = o.id AND m.user_id = $1
             WHERE o.monthly_token_budget IS NOT NULL AND o.monthly_token_budget > 0`,
            [userId],
        );
        return r.rows.map((row) => ({ orgId: row.org_id, budget: Number(row.monthly_token_budget), memberIds: row.member_ids }));
    }
}
