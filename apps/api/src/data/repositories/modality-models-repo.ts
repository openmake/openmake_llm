/**
 * @module data/repositories/modality-models-repo
 * @description 모달리티→모델 배정(modality_models) 저장소 — 전역('__global__')·사용자 scope 공용.
 *
 * "역할&모델"(user_model_roles/global_model_roles)과 별개 축. 해석은 services/modality-resolver.
 *
 * @see db/migrations/117_modality_models.sql
 */
import { BaseRepository } from './base-repository';
import { GLOBAL_MODALITY_SCOPE, type Modality } from '../../config/modality';

export interface ModalityModelRow {
    scope: string;
    modality: Modality;
    fullId: string;
    params: Record<string, string>;
    updatedAt: Date;
}

interface DbRow {
    scope: string;
    modality: Modality;
    full_id: string;
    params: Record<string, string> | null;
    updated_at: Date;
    [key: string]: unknown;
}

function toRow(row: DbRow): ModalityModelRow {
    return {
        scope: row.scope,
        modality: row.modality,
        fullId: row.full_id,
        params: row.params ?? {},
        updatedAt: row.updated_at,
    };
}

export class ModalityModelsRepository extends BaseRepository {
    async listByScope(scope: string): Promise<ModalityModelRow[]> {
        const result = await this.query<DbRow>(
            `SELECT * FROM modality_models WHERE scope = $1 ORDER BY modality`,
            [scope],
        );
        return result.rows.map(toRow);
    }

    async listGlobal(): Promise<ModalityModelRow[]> {
        return this.listByScope(GLOBAL_MODALITY_SCOPE);
    }

    async get(scope: string, modality: Modality): Promise<ModalityModelRow | null> {
        const result = await this.query<DbRow>(
            `SELECT * FROM modality_models WHERE scope = $1 AND modality = $2`,
            [scope, modality],
        );
        return result.rows[0] ? toRow(result.rows[0]) : null;
    }

    /** 배정/변경 — 직전 fullId 를 같은 트랜잭션에서 캡처해 감사 로그용으로 함께 돌려준다 */
    async upsert(
        scope: string,
        modality: Modality,
        fullId: string,
        params: Record<string, string>,
    ): Promise<{ row: ModalityModelRow; previous: string | null }> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`mm:${scope}:${modality}`]);
            const prev = await client.query<DbRow>(
                `SELECT full_id FROM modality_models WHERE scope = $1 AND modality = $2`,
                [scope, modality],
            );
            const upserted = await client.query<DbRow>(
                `INSERT INTO modality_models (scope, modality, full_id, params)
                 VALUES ($1, $2, $3, $4::jsonb)
                 ON CONFLICT (scope, modality) DO UPDATE SET
                    full_id = EXCLUDED.full_id,
                    params = EXCLUDED.params,
                    updated_at = NOW()
                 RETURNING *`,
                [scope, modality, fullId, JSON.stringify(params)],
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
    async insertIfAbsent(scope: string, modality: Modality, fullId: string): Promise<boolean> {
        const result = await this.query(
            `INSERT INTO modality_models (scope, modality, full_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (scope, modality) DO NOTHING`,
            [scope, modality, fullId],
        );
        return (result.rowCount ?? 0) > 0;
    }

    async delete(scope: string, modality: Modality): Promise<boolean> {
        const result = await this.query(
            `DELETE FROM modality_models WHERE scope = $1 AND modality = $2`,
            [scope, modality],
        );
        return (result.rowCount ?? 0) > 0;
    }
}
