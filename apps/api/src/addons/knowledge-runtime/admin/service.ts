/**
 * Knowledge 관리자 서비스 — 상태·프로필·재색인·재청킹. 라우트에서 관리자 게이트 뒤에만 호출한다.
 *
 * @module addons/knowledge-runtime/admin/service
 */
import { AppError } from '../../../utils/error-handler';
import { kdb } from '../db';
import { enqueueJob } from '../jobs/queue';
import { clearProfileCache } from '../config/profiles';
import { PROFILE_CONFIG_SCHEMAS } from '../schemas';
import { pgvectorVersion } from '../capabilities';

export interface AdminStatus {
    embeddingIndex: {
        id: string; providerRef: string; modelId: string; dimension: number;
        distanceMetric: string; status: string; activatedAt: string | null;
    } | null;
    jobCounts: Record<string, number>;
    pgvectorVersion: string | null;
}

export async function getAdminStatus(): Promise<AdminStatus> {
    const idx = await kdb().query<{
        id: string; provider_ref: string; model_id: string; dimension: number;
        distance_metric: string; status: string; activated_at: string | null;
    }>(`SELECT id, provider_ref, model_id, dimension, distance_metric, status, activated_at
        FROM knowledge_embedding_indexes WHERE is_active = TRUE LIMIT 1`);
    const jobs = await kdb().query<{ state: string; n: string }>(
        `SELECT state, COUNT(*)::text AS n FROM knowledge_ingestion_jobs GROUP BY state`,
    );
    const jobCounts: Record<string, number> = {};
    for (const r of jobs.rows) jobCounts[r.state] = parseInt(r.n, 10);
    const row = idx.rows[0];
    return {
        embeddingIndex: row
            ? {
                id: row.id, providerRef: row.provider_ref, modelId: row.model_id, dimension: row.dimension,
                distanceMetric: row.distance_metric, status: row.status, activatedAt: row.activated_at,
            }
            : null,
        jobCounts,
        pgvectorVersion: await pgvectorVersion().catch(() => null),
    };
}

export interface ProfileRow { id: string; kind: string; name: string; config: unknown; is_default: boolean; updated_at: string }

export async function listProfiles(): Promise<ProfileRow[]> {
    const r = await kdb().query<ProfileRow>(
        `SELECT id, kind, name, config, is_default, updated_at FROM knowledge_profiles ORDER BY kind, id`,
    );
    return r.rows;
}

/** 프로필 갱신 — kind 별 Zod 스키마로 config 를 검증한 뒤 저장하고 캐시를 비운다. */
export async function updateProfile(id: string, body: { name?: string; config: Record<string, unknown> }): Promise<ProfileRow> {
    const existing = await kdb().query<{ kind: string }>(`SELECT kind FROM knowledge_profiles WHERE id = $1`, [id]);
    const kind = existing.rows[0]?.kind;
    if (!kind) throw new AppError('프로필', 404, true, 'NOT_FOUND');

    const schema = PROFILE_CONFIG_SCHEMAS[kind];
    if (!schema) throw new AppError(`알 수 없는 프로필 종류: ${kind}`, 400, true, 'BAD_REQUEST');
    const parsed = schema.safeParse(body.config);
    if (!parsed.success) {
        throw new AppError(`프로필 config 검증 실패: ${parsed.error.issues[0]?.message ?? '오류'}`, 400, true, 'VALIDATION_ERROR');
    }

    const sets = ['config = $2::jsonb', 'updated_at = NOW()'];
    const params: unknown[] = [id, JSON.stringify(parsed.data)];
    if (body.name !== undefined) { params.push(body.name); sets.push(`name = $${params.length}`); }
    const r = await kdb().query<ProfileRow>(
        `UPDATE knowledge_profiles SET ${sets.join(', ')} WHERE id = $1 RETURNING id, kind, name, config, is_default, updated_at`,
        params,
    );
    clearProfileCache();
    return r.rows[0];
}

/** 관리자 재청킹 — 존재하는(미삭제) Space 만. 청크 정책 변경은 재수집이므로 rechunk 작업을 큐잉. */
export async function rechunkSpace(spaceId: string): Promise<void> {
    const exists = await kdb().query(
        `SELECT 1 FROM knowledge_spaces WHERE id = $1 AND deleted_at IS NULL`,
        [spaceId],
    );
    if ((exists.rowCount ?? 0) === 0) throw new AppError('Knowledge Space', 404, true, 'NOT_FOUND');
    await enqueueJob({ kind: 'rechunk', spaceId });
}
