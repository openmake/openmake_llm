/**
 * Add-on 설치·상태 저장소 (마이그레이션 165, 2026-09-19).
 *
 * 내장 add-on 과 설치형 확장이 **같은 표**를 쓴다 — 상태는 4개(installed·enabled·disabled·failed)뿐이고,
 * 켜고 끄기의 authority 는 이 표다(env `ADDON_BUILTIN_DISABLED` 는 그 위의 비상 override).
 *
 * @module data/repositories/addon-state-repository
 */
import type { Pool } from 'pg';

export const ADDON_STATES = ['installed', 'enabled', 'disabled', 'failed'] as const;
export type AddonState = typeof ADDON_STATES[number];

export const ADDON_SOURCES = ['builtin', 'git', 'zip', 'local', 'marketplace'] as const;
export type AddonSource = typeof ADDON_SOURCES[number];

export interface AddonInstallationRow {
    addon_id: string;
    name: string;
    version: string;
    kind: string;
    source: AddonSource;
    state: AddonState;
    failure_reason: string | null;
    entitlement_sku: string | null;
    installed_at: string;
    updated_at: string;
}

export class AddonStateRepository {
    constructor(private pool: Pool) {}

    async list(): Promise<AddonInstallationRow[]> {
        const r = await this.pool.query<AddonInstallationRow>(
            'SELECT * FROM addon_installations ORDER BY addon_id ASC',
        );
        return r.rows;
    }

    async get(addonId: string): Promise<AddonInstallationRow | null> {
        const r = await this.pool.query<AddonInstallationRow>(
            'SELECT * FROM addon_installations WHERE addon_id = $1', [addonId],
        );
        return r.rows[0] ?? null;
    }

    /**
     * 발견된 add-on 을 표에 반영한다. **state 는 건드리지 않는다** — 관리자가 끈 add-on 이
     * 재부팅으로 되살아나면 안 된다(163 카탈로그 설치와 같은 규칙).
     */
    async upsertDiscovered(input: {
        addonId: string; name: string; version: string; kind: string;
        source: AddonSource; entitlementSku?: string | null; initialState?: AddonState;
    }): Promise<void> {
        await this.pool.query(
            `INSERT INTO addon_installations (addon_id, name, version, kind, source, state, entitlement_sku)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (addon_id) DO UPDATE SET
                name = EXCLUDED.name,
                version = EXCLUDED.version,
                kind = EXCLUDED.kind,
                source = EXCLUDED.source,
                entitlement_sku = EXCLUDED.entitlement_sku,
                updated_at = NOW()`,
            [input.addonId, input.name, input.version, input.kind, input.source,
                input.initialState ?? 'enabled', input.entitlementSku ?? null],
        );
    }

    async setState(addonId: string, state: AddonState, failureReason?: string | null): Promise<AddonInstallationRow | null> {
        const r = await this.pool.query<AddonInstallationRow>(
            `UPDATE addon_installations
                SET state = $2, failure_reason = $3, updated_at = NOW()
              WHERE addon_id = $1
              RETURNING *`,
            [addonId, state, failureReason ?? null],
        );
        return r.rows[0] ?? null;
    }
}
