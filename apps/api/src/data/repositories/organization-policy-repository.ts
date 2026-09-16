/**
 * 조직 정책 저장소 (129).
 * @module data/repositories/organization-policy-repository
 */
import { BaseRepository } from './base-repository';

export interface OrgPolicyRow {
    org_id: string;
    key: string;
    value: unknown;
    updated_by: string | null;
    updated_at: string;
}

export class OrganizationPolicyRepository extends BaseRepository {
    async list(orgId: string): Promise<OrgPolicyRow[]> {
        const r = await this.query<OrgPolicyRow>('SELECT * FROM organization_policies WHERE org_id = $1 ORDER BY key', [orgId]);
        return r.rows;
    }

    async upsert(orgId: string, key: string, value: unknown, updatedBy: string | null): Promise<OrgPolicyRow> {
        const r = await this.query<OrgPolicyRow>(
            `INSERT INTO organization_policies (org_id, key, value, updated_by)
             VALUES ($1, $2, $3::jsonb, $4)
             ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
             RETURNING *`,
            [orgId, key, JSON.stringify(value), updatedBy],
        );
        return r.rows[0];
    }

    async remove(orgId: string, key: string): Promise<boolean> {
        const r = await this.query('DELETE FROM organization_policies WHERE org_id = $1 AND key = $2', [orgId, key]);
        return (r.rowCount ?? 0) > 0;
    }
}
