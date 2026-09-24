/**
 * @module data/repositories/model-assignments-repo
 * @description 모델 배정 통합 저장소(model_assignments) — 역할별 모델·기능별 모델을 하나의 슬롯 정의로 합친
 * 유일한 배정 테이블(2026-09-24, 170). scope 는 '__global__' 또는 사용자 id, slot 은 config/model-slots 의 슬롯 id.
 *
 * 옛 세 테이블(user_model_roles·global_model_roles·capability_models)의 저장소는 이 저장소를 감싸는 어댑터로 바뀌었다
 * (역할→슬롯·기능→슬롯 매핑). 실제 SQL 은 여기 한 곳뿐이다.
 *
 * @see db/migrations/170_model_assignments.sql
 * @see config/model-slots.ts
 */
import { BaseRepository } from './base-repository';

export interface ModelAssignmentRow {
    scope: string;
    slot: string;
    fullId: string;
    params: Record<string, string>;
    updatedAt: Date;
}

interface DbRow {
    scope: string;
    slot: string;
    full_id: string;
    params: Record<string, string> | null;
    updated_at: Date;
    [key: string]: unknown;
}

function toRow(row: DbRow): ModelAssignmentRow {
    return {
        scope: row.scope,
        slot: row.slot,
        fullId: row.full_id,
        params: row.params ?? {},
        updatedAt: row.updated_at,
    };
}

export class ModelAssignmentsRepository extends BaseRepository {
    async listByScope(scope: string): Promise<ModelAssignmentRow[]> {
        const result = await this.query<DbRow>(
            `SELECT * FROM model_assignments WHERE scope = $1 ORDER BY slot`,
            [scope],
        );
        return result.rows.map(toRow);
    }

    async get(scope: string, slot: string): Promise<ModelAssignmentRow | null> {
        const result = await this.query<DbRow>(
            `SELECT * FROM model_assignments WHERE scope = $1 AND slot = $2`,
            [scope, slot],
        );
        return result.rows[0] ? toRow(result.rows[0]) : null;
    }

    /**
     * 배정/변경 — 직전 fullId 를 같은 트랜잭션에서 원자적으로 캡처해 감사 로그용으로 함께 돌려준다.
     * per-key advisory lock 으로 같은 (scope,slot) 동시 변경을 직렬화해 previous 가 실제 직전값과 일치하게 한다.
     */
    async upsert(
        scope: string,
        slot: string,
        fullId: string,
        params: Record<string, string>,
    ): Promise<{ row: ModelAssignmentRow; previous: string | null }> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ma:${scope}:${slot}`]);
            const prev = await client.query<DbRow>(
                `SELECT full_id FROM model_assignments WHERE scope = $1 AND slot = $2`,
                [scope, slot],
            );
            const upserted = await client.query<DbRow>(
                `INSERT INTO model_assignments (scope, slot, full_id, params)
                 VALUES ($1, $2, $3, $4::jsonb)
                 ON CONFLICT (scope, slot) DO UPDATE SET
                    full_id = EXCLUDED.full_id,
                    params = EXCLUDED.params,
                    updated_at = NOW()
                 RETURNING *`,
                [scope, slot, fullId, JSON.stringify(params)],
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
    async insertIfAbsent(scope: string, slot: string, fullId: string): Promise<boolean> {
        const result = await this.query(
            `INSERT INTO model_assignments (scope, slot, full_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (scope, slot) DO NOTHING`,
            [scope, slot, fullId],
        );
        return (result.rowCount ?? 0) > 0;
    }

    /** 배정 해제 — 삭제된 직전 값(previous)을 RETURNING 으로 원자적으로 함께 반환 */
    async delete(scope: string, slot: string): Promise<{ deleted: boolean; previous: string | null }> {
        const result = await this.query<{ full_id: string }>(
            `DELETE FROM model_assignments WHERE scope = $1 AND slot = $2 RETURNING full_id`,
            [scope, slot],
        );
        return { deleted: (result.rowCount ?? 0) > 0, previous: result.rows[0]?.full_id ?? null };
    }
}
