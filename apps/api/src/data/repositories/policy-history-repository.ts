/**
 * 설정·조직 정책 변경 이력 (130). 기록 실패는 호출부에서 fail-open(변경 자체는 반영).
 * @module data/repositories/policy-history-repository
 */
import { BaseRepository } from './base-repository';

export interface SettingHistoryRow { id: number; key: string; old_value: string | null; new_value: string | null; changed_by: string | null; changed_at: string }
export interface OrgPolicyHistoryRow { id: number; org_id: string; key: string; old_value: unknown; new_value: unknown; changed_by: string | null; changed_at: string }

export const SECRET_MASK = '***';

export class PolicyHistoryRepository extends BaseRepository {
    async recordSetting(key: string, oldValue: string | null, newValue: string | null, changedBy: string | null): Promise<void> {
        await this.query(
            'INSERT INTO system_settings_history (key, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4)',
            [key, oldValue, newValue, changedBy],
        );
    }

    async listSettings(key: string | undefined, limit: number): Promise<SettingHistoryRow[]> {
        const r = key
            ? await this.query<SettingHistoryRow>('SELECT * FROM system_settings_history WHERE key = $1 ORDER BY changed_at DESC LIMIT $2', [key, limit])
            : await this.query<SettingHistoryRow>('SELECT * FROM system_settings_history ORDER BY changed_at DESC LIMIT $1', [limit]);
        return r.rows;
    }

    async recordOrgPolicy(orgId: string, key: string, oldValue: unknown, newValue: unknown, changedBy: string | null): Promise<void> {
        await this.query(
            'INSERT INTO organization_policy_history (org_id, key, old_value, new_value, changed_by) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)',
            [orgId, key, oldValue === undefined ? null : JSON.stringify(oldValue), newValue === undefined ? null : JSON.stringify(newValue), changedBy],
        );
    }

    async listOrgPolicies(orgId: string, limit: number): Promise<OrgPolicyHistoryRow[]> {
        const r = await this.query<OrgPolicyHistoryRow>(
            'SELECT * FROM organization_policy_history WHERE org_id = $1 ORDER BY changed_at DESC LIMIT $2', [orgId, limit]);
        return r.rows;
    }
}
