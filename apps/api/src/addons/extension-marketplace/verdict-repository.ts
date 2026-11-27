/**
 * 판정 캐시 저장소 — 표 `market_verdicts`(팩 마이그레이션 addon:extension-marketplace:001). 이 add-on 이 소유한 표만 읽고 쓴다.
 *
 * @module addons/extension-marketplace/verdict-repository
 */
import type { Pool } from 'pg';
import type { Verdict } from './constants';
import type { ComputedVerdict, VerdictProvenance, VerdictReason } from './verdict';

export interface CachedVerdict extends ComputedVerdict {
    verdictVersion: number;
    catalogSyncedAt: string | null;
    computedAt: string;
    expiresAt: string;
}

interface Row {
    plugin_name: string;
    verdict: Verdict;
    reasons: VerdictReason[] | null;
    provenance: VerdictProvenance | null;
    evaluated: ComputedVerdict['evaluated'];
    source_url: string;
    verdict_version: number;
    catalog_synced_at: Date | string | null;
    computed_at: Date | string;
    expires_at: Date | string;
}

function iso(v: Date | string | null): string | null {
    if (v === null) return null;
    return v instanceof Date ? v.toISOString() : String(v);
}

export class VerdictRepository {
    constructor(private readonly pool: Pick<Pool, 'query'>) {}

    async listByCatalog(catalogId: string): Promise<CachedVerdict[]> {
        const r = await this.pool.query<Row>(
            `SELECT plugin_name, verdict, reasons, provenance, evaluated, source_url, verdict_version,
                    catalog_synced_at, computed_at, expires_at
               FROM market_verdicts WHERE catalog_id = $1`,
            [catalogId],
        );
        return r.rows.map(row => ({
            plugin: row.plugin_name,
            verdict: row.verdict,
            reasons: row.reasons ?? [],
            provenance: row.provenance ?? { publisher: null, commit: null, license: null, sourceUrl: row.source_url },
            evaluated: row.evaluated,
            verdictVersion: row.verdict_version,
            catalogSyncedAt: iso(row.catalog_synced_at),
            computedAt: iso(row.computed_at) ?? '',
            expiresAt: iso(row.expires_at) ?? '',
        }));
    }

    async upsertMany(
        catalogId: string,
        items: readonly ComputedVerdict[],
        meta: { verdictVersion: number; catalogSyncedAt: string | null; expiresAt: Date },
    ): Promise<void> {
        for (const v of items) {
            await this.pool.query(
                `INSERT INTO market_verdicts (catalog_id, plugin_name, source_url, commit_sha, verdict, reasons, provenance,
                                              evaluated, verdict_version, catalog_synced_at, computed_at, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, NOW(), $11)
                 ON CONFLICT (catalog_id, plugin_name) DO UPDATE SET
                    source_url = EXCLUDED.source_url, commit_sha = EXCLUDED.commit_sha, verdict = EXCLUDED.verdict,
                    reasons = EXCLUDED.reasons, provenance = EXCLUDED.provenance, evaluated = EXCLUDED.evaluated,
                    verdict_version = EXCLUDED.verdict_version, catalog_synced_at = EXCLUDED.catalog_synced_at,
                    computed_at = NOW(), expires_at = EXCLUDED.expires_at`,
                [
                    catalogId, v.plugin, v.provenance.sourceUrl, v.provenance.commit, v.verdict,
                    JSON.stringify(v.reasons), JSON.stringify(v.provenance), v.evaluated,
                    meta.verdictVersion, meta.catalogSyncedAt, meta.expiresAt,
                ],
            );
        }
    }

    /** 스냅샷에서 빠진 항목의 판정을 지운다 */
    async deleteMissing(catalogId: string, keepPlugins: readonly string[]): Promise<void> {
        await this.pool.query(
            'DELETE FROM market_verdicts WHERE catalog_id = $1 AND NOT (plugin_name = ANY($2::text[]))',
            [catalogId, [...keepPlugins]],
        );
    }
}
