/**
 * @module data/repositories/capability-models-repo
 * @description capability→모델 배정(capability_models) 저장소 — 멀티모달 오케스트레이터 — 전역('__global__')·사용자 scope 공용.
 *
 * "역할&모델"과 별개 축. 해석은 services/capability-resolver.
 *
 * @see db/migrations/118_capability_models.sql
 */
import { BaseRepository } from './base-repository';
import { GLOBAL_CAPABILITY_SCOPE, type Capability } from '../../config/capabilities';

export interface CapabilityModelRow {
    scope: string;
    capability: Capability;
    fullId: string;
    params: Record<string, string>;
    updatedAt: Date;
}

interface DbRow {
    scope: string;
    capability: Capability;
    full_id: string;
    params: Record<string, string> | null;
    updated_at: Date;
    [key: string]: unknown;
}

function toRow(row: DbRow): CapabilityModelRow {
    return {
        scope: row.scope,
        capability: row.capability,
        fullId: row.full_id,
        params: row.params ?? {},
        updatedAt: row.updated_at,
    };
}

export class CapabilityModelsRepository extends BaseRepository {
    async listByScope(scope: string): Promise<CapabilityModelRow[]> {
        const result = await this.query<DbRow>(
            `SELECT * FROM capability_models WHERE scope = $1 ORDER BY capability`,
            [scope],
        );
        return result.rows.map(toRow);
    }

    async listGlobal(): Promise<CapabilityModelRow[]> {
        return this.listByScope(GLOBAL_CAPABILITY_SCOPE);
    }

    async get(scope: string, capability: Capability): Promise<CapabilityModelRow | null> {
        const result = await this.query<DbRow>(
            `SELECT * FROM capability_models WHERE scope = $1 AND capability = $2`,
            [scope, capability],
        );
        return result.rows[0] ? toRow(result.rows[0]) : null;
    }

    /** 배정/변경 — 직전 fullId 를 같은 트랜잭션에서 캡처해 감사 로그용으로 함께 돌려준다 */
    async upsert(
        scope: string,
        capability: Capability,
        fullId: string,
        params: Record<string, string>,
    ): Promise<{ row: CapabilityModelRow; previous: string | null }> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cm:${scope}:${capability}`]);
            const prev = await client.query<DbRow>(
                `SELECT full_id FROM capability_models WHERE scope = $1 AND capability = $2`,
                [scope, capability],
            );
            const upserted = await client.query<DbRow>(
                `INSERT INTO capability_models (scope, capability, full_id, params)
                 VALUES ($1, $2, $3, $4::jsonb)
                 ON CONFLICT (scope, capability) DO UPDATE SET
                    full_id = EXCLUDED.full_id,
                    params = EXCLUDED.params,
                    updated_at = NOW()
                 RETURNING *`,
                [scope, capability, fullId, JSON.stringify(params)],
            );
            await client.query('COMMIT');
            return { row: toRow(upserted.rows[0]), previous: prev.rows[0]?.full_id ?? null };
        } catch (err) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw err;
        } finally {
            client.release();
        }
    }

    /** 미존재 시에만 삽입(시더용) — 이미 있으면 false */
    async insertIfAbsent(scope: string, capability: Capability, fullId: string): Promise<boolean> {
        const result = await this.query(
            `INSERT INTO capability_models (scope, capability, full_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (scope, capability) DO NOTHING`,
            [scope, capability, fullId],
        );
        return (result.rowCount ?? 0) > 0;
    }

    async delete(scope: string, capability: Capability): Promise<boolean> {
        const result = await this.query(
            `DELETE FROM capability_models WHERE scope = $1 AND capability = $2`,
            [scope, capability],
        );
        return (result.rowCount ?? 0) > 0;
    }
}
