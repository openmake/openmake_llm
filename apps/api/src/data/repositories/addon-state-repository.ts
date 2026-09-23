/**
 * Add-on 설치·상태 저장소 (마이그레이션 165 + 167, 2026-09-19 / 09-23).
 *
 * 내장 add-on 과 설치형 확장이 **같은 표**를 쓴다. 두 축을 분리해 둔다(P01):
 *   - `state`         : 호환 응답용 상태 4개(installed·enabled·disabled·failed). 부팅 결과가 섞인다.
 *   - `desired_state` : 관리자의 사용 의도(enabled·disabled)뿐 — **부팅 실패가 이 값을 바꾸지 않는다**.
 *   - `state_revision`: 상태가 바뀔 때마다 증가 — 승인 뒤 정책 변경 탐지용.
 * 켜고 끄기의 authority 는 이 표다(env `ADDON_BUILTIN_DISABLED` 는 그 위의 비상 override).
 *
 * @module data/repositories/addon-state-repository
 */
import type { Pool } from 'pg';

export const ADDON_STATES = ['installed', 'enabled', 'disabled', 'failed'] as const;
export type AddonState = typeof ADDON_STATES[number];

export const ADDON_DESIRED_STATES = ['enabled', 'disabled'] as const;
export type AddonDesiredState = typeof ADDON_DESIRED_STATES[number];

/** 부팅 실패 분류 — 관리자 화면·복구 판단이 문자열이 아니라 코드로 읽는다 */
export const ADDON_FAILURE_CODES = ['migration_failed', 'runtime_failed', 'version_mismatch', 'registration_failed', 'needs_retry'] as const;
export type AddonFailureCode = typeof ADDON_FAILURE_CODES[number];

export const ADDON_SOURCES = ['builtin', 'git', 'zip', 'local', 'marketplace'] as const;
export type AddonSource = typeof ADDON_SOURCES[number];

export interface AddonInstallationRow {
    addon_id: string;
    name: string;
    version: string;
    kind: string;
    source: AddonSource;
    state: AddonState;
    desired_state: AddonDesiredState;
    state_revision: number;
    last_failure_code: AddonFailureCode | null;
    failure_reason: string | null;
    entitlement_sku: string | null;
    installed_at: string;
    updated_at: string;
}

/** 관리자가 고른 호환 `state` → 의도. failed/installed 는 의도가 아니므로 각각 기존 의도 유지·disabled. */
export function desiredStateFor(state: AddonState): AddonDesiredState | null {
    if (state === 'enabled') return 'enabled';
    if (state === 'disabled' || state === 'installed') return 'disabled';
    return null;
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
     * 발견된 add-on 을 표에 반영한다. **state·desired_state 는 건드리지 않는다** — 관리자가 끈 add-on 이
     * 재부팅으로 되살아나면 안 된다(163 카탈로그 설치와 같은 규칙).
     */
    async upsertDiscovered(input: {
        addonId: string; name: string; version: string; kind: string;
        source: AddonSource; entitlementSku?: string | null; initialState?: AddonState;
    }): Promise<void> {
        const initial = input.initialState ?? 'enabled';
        await this.pool.query(
            `INSERT INTO addon_installations (addon_id, name, version, kind, source, state, desired_state, entitlement_sku)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (addon_id) DO UPDATE SET
                name = EXCLUDED.name,
                version = EXCLUDED.version,
                kind = EXCLUDED.kind,
                source = EXCLUDED.source,
                entitlement_sku = EXCLUDED.entitlement_sku,
                updated_at = NOW()`,
            [input.addonId, input.name, input.version, input.kind, input.source,
                initial, desiredStateFor(initial) ?? 'disabled', input.entitlementSku ?? null],
        );
    }

    /**
     * 관리자 토글 — 호환 `state` 와 함께 의도(`desired_state`)를 기록하고 revision 을 올린다.
     * failed 로의 수동 전환은 의도를 바꾸지 않는다(의도는 enabled/disabled 뿐).
     */
    async setState(addonId: string, state: AddonState, failureReason?: string | null): Promise<AddonInstallationRow | null> {
        const desired = desiredStateFor(state);
        const r = await this.pool.query<AddonInstallationRow>(
            `UPDATE addon_installations
                SET state = $2,
                    desired_state = COALESCE($4, desired_state),
                    failure_reason = $3,
                    last_failure_code = CASE WHEN $2 = 'failed' THEN last_failure_code ELSE NULL END,
                    state_revision = state_revision + 1,
                    updated_at = NOW()
              WHERE addon_id = $1
              RETURNING *`,
            [addonId, state, failureReason ?? null, desired],
        );
        return r.rows[0] ?? null;
    }

    /** 부팅 실패 기록 — 호환 state 만 failed 로, **의도는 그대로**(관리자가 켜 둔 사실을 잃지 않는다). */
    async markBootFailure(addonId: string, code: AddonFailureCode, reason: string): Promise<void> {
        await this.pool.query(
            `UPDATE addon_installations
                SET state = 'failed', last_failure_code = $2, failure_reason = $3,
                    state_revision = state_revision + 1, updated_at = NOW()
              WHERE addon_id = $1`,
            [addonId, code, reason.slice(0, 2000)],
        );
    }

    /** 정상 부팅 — 직전 실패 흔적을 지우고, 의도가 enabled 면 호환 state 도 enabled 로 되돌린다. */
    async markBootSucceeded(addonId: string): Promise<void> {
        await this.pool.query(
            `UPDATE addon_installations
                SET state = CASE WHEN desired_state = 'enabled' THEN 'enabled' ELSE state END,
                    last_failure_code = NULL, failure_reason = NULL,
                    state_revision = state_revision + 1, updated_at = NOW()
              WHERE addon_id = $1 AND (state = 'failed' OR last_failure_code IS NOT NULL)`,
            [addonId],
        );
    }
}
