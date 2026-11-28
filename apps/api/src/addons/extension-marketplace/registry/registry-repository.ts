/**
 * 레지스트리 사본 저장소 — 표 `market_registry_entries`·`market_registry_sync_state`(팩 마이그레이션 002). 이 add-on 소유 표만 쓴다.
 *
 * 항목 규칙:
 *  - 최신 판(isLatest)만 새 행을 만들거나 판을 바꾼다. 최신이 아닌 판의 소식은 저장된 판과 같을 때만 상태를 고친다.
 *  - 판이 바뀌면(설치 정보가 달라질 수 있다) 큐레이션을 pending 으로 되돌린다 — 승인은 그 판에 대한 것이다.
 *  - status=deleted 면 tombstoned_at 을 채운다(행은 남긴다). 다시 active·deprecated 가 되면 지운다.
 *
 * @module addons/extension-marketplace/registry/registry-repository
 */
import type { Pool } from 'pg';
import type { RegistryEntry, RegistryPackage, RegistryRemote, RegistryStatus } from './server-json';

export type Curation = 'pending' | 'approved' | 'hidden';

export interface StoredRegistryEntry {
    serverName: string;
    namespace: string;
    version: string;
    title: string | null;
    description: string | null;
    websiteUrl: string | null;
    repositoryUrl: string | null;
    remotes: RegistryRemote[];
    packages: RegistryPackage[];
    status: RegistryStatus;
    statusMessage: string | null;
    publishedAt: string | null;
    registryUpdatedAt: string | null;
    tombstonedAt: string | null;
    curation: Curation;
    curatedAt: string | null;
    promotedCatalogId: string | null;
    lastSeenAt: string;
}

export interface SyncState {
    cursor: string | null;
    runUpdatedSince: string | null;
    runStartedAt: string | null;
    watermark: string | null;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    backoffUntil: string | null;
    failureCount: number;
    lastError: string | null;
    lastStats: Record<string, number>;
}

export type SyncStatePatch = Partial<SyncState>;

export interface ListOptions {
    curation?: Curation | 'all';
    includeTombstoned?: boolean;
    search?: string;
    /** 검색어가 있을 때 관련도 순(정확 일치 → 앞부분 일치 → 이름·제목 포함 → 설명만 포함), 같은 순위는 이름순. 없으면 이름순(종전) */
    rank?: boolean;
    limit: number;
    offset: number;
}

type Db = Pick<Pool, 'query'>;

function iso(v: Date | string | null | undefined): string | null {
    if (v === null || v === undefined) return null;
    return v instanceof Date ? v.toISOString() : String(v);
}

interface EntryRow {
    server_name: string; namespace: string; version: string; title: string | null; description: string | null;
    website_url: string | null; repository_url: string | null; remotes: RegistryRemote[] | null; packages: RegistryPackage[] | null;
    registry_status: RegistryStatus; status_message: string | null; published_at: Date | null; registry_updated_at: Date | null;
    tombstoned_at: Date | null; curation: Curation; curated_at: Date | null; promoted_catalog_id: string | null; last_seen_at: Date;
}

function toEntry(r: EntryRow): StoredRegistryEntry {
    return {
        serverName: r.server_name, namespace: r.namespace, version: r.version, title: r.title, description: r.description,
        websiteUrl: r.website_url, repositoryUrl: r.repository_url, remotes: r.remotes ?? [], packages: r.packages ?? [],
        status: r.registry_status, statusMessage: r.status_message, publishedAt: iso(r.published_at),
        registryUpdatedAt: iso(r.registry_updated_at), tombstonedAt: iso(r.tombstoned_at), curation: r.curation,
        curatedAt: iso(r.curated_at), promotedCatalogId: r.promoted_catalog_id, lastSeenAt: iso(r.last_seen_at) ?? '',
    };
}

const ENTRY_COLUMNS = `server_name, namespace, version, title, description, website_url, repository_url, remotes, packages,
    registry_status, status_message, published_at, registry_updated_at, tombstoned_at, curation, curated_at,
    promoted_catalog_id, last_seen_at`;

/** 상태 패치 키 → 열 이름(룩업 맵) */
const STATE_COLUMNS: Readonly<Record<keyof SyncState, string>> = {
    cursor: 'cursor', runUpdatedSince: 'run_updated_since', runStartedAt: 'run_started_at', watermark: 'watermark',
    lastAttemptAt: 'last_attempt_at', lastSuccessAt: 'last_success_at', backoffUntil: 'backoff_until',
    failureCount: 'failure_count', lastError: 'last_error', lastStats: 'last_stats',
};

export class RegistryRepository {
    constructor(private readonly db: Db, private readonly sourceId: string) {}

    /** 저장했으면 'inserted'·'updated', 규칙상 건너뛰면 'ignored' */
    async applyEntry(e: RegistryEntry): Promise<'inserted' | 'updated' | 'ignored'> {
        const tomb = e.status === 'deleted';
        if (!e.isLatest) {
            const r = await this.db.query(
                `UPDATE market_registry_entries SET registry_status = $3, status_message = $4, registry_updated_at = $5,
                        tombstoned_at = CASE WHEN $6 THEN COALESCE(tombstoned_at, NOW()) ELSE NULL END, last_seen_at = NOW()
                  WHERE source_id = $1 AND server_name = $2 AND version = $7`,
                [this.sourceId, e.serverName, e.status, e.statusMessage, e.updatedAt, tomb, e.version],
            );
            return (r.rowCount ?? 0) > 0 ? 'updated' : 'ignored';
        }
        const r = await this.db.query<{ inserted: boolean }>(
            `INSERT INTO market_registry_entries (source_id, server_name, namespace, version, schema_url, title, description,
                    website_url, repository_url, remotes, packages, registry_status, status_message, published_at,
                    registry_updated_at, tombstoned_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, CASE WHEN $16 THEN NOW() END)
             ON CONFLICT (source_id, server_name) DO UPDATE SET
                namespace = EXCLUDED.namespace, schema_url = EXCLUDED.schema_url, title = EXCLUDED.title,
                description = EXCLUDED.description, website_url = EXCLUDED.website_url, repository_url = EXCLUDED.repository_url,
                remotes = EXCLUDED.remotes, packages = EXCLUDED.packages, registry_status = EXCLUDED.registry_status,
                status_message = EXCLUDED.status_message, published_at = EXCLUDED.published_at,
                registry_updated_at = EXCLUDED.registry_updated_at,
                tombstoned_at = CASE WHEN $16 THEN COALESCE(market_registry_entries.tombstoned_at, NOW()) ELSE NULL END,
                curation = CASE WHEN market_registry_entries.version <> EXCLUDED.version THEN 'pending' ELSE market_registry_entries.curation END,
                curated_by = CASE WHEN market_registry_entries.version <> EXCLUDED.version THEN NULL ELSE market_registry_entries.curated_by END,
                curated_at = CASE WHEN market_registry_entries.version <> EXCLUDED.version THEN NULL ELSE market_registry_entries.curated_at END,
                version = EXCLUDED.version, last_seen_at = NOW()
             RETURNING (xmax = 0) AS inserted`,
            [
                this.sourceId, e.serverName, e.namespace, e.version, e.schemaUrl, e.title, e.description, e.websiteUrl,
                e.repositoryUrl, JSON.stringify(e.remotes), JSON.stringify(e.packages), e.status, e.statusMessage,
                e.publishedAt, e.updatedAt, tomb,
            ],
        );
        return r.rows[0]?.inserted ? 'inserted' : 'updated';
    }

    async list(opts: ListOptions): Promise<{ entries: StoredRegistryEntry[]; total: number }> {
        const where = ['source_id = $1'];
        const params: unknown[] = [this.sourceId];
        if (!opts.includeTombstoned) where.push('tombstoned_at IS NULL');
        if (opts.curation && opts.curation !== 'all') {
            params.push(opts.curation);
            where.push(`curation = $${params.length}`);
        }
        let order = 'server_name';
        if (opts.search) {
            const esc = opts.search.replace(/[\\%_]/g, c => `\\${c}`);
            params.push(`%${esc}%`);
            const like = params.length;
            where.push(`(server_name ILIKE $${like} OR title ILIKE $${like} OR description ILIKE $${like})`);
            if (opts.rank) {
                // 이름의 끝 부분(`io.github.acme/weather` → `weather`)과 제목을 먼저 본다 — 네임스페이스(`io.github.*`)는 거의 모든 항목에 걸린다
                params.push(esc, `${esc}%`);
                const exact = params.length - 1, prefix = params.length;
                const tail = `split_part(server_name, '/', 2)`;
                order = `CASE WHEN ${tail} ILIKE $${exact} OR title ILIKE $${exact} THEN 0
                              WHEN ${tail} ILIKE $${prefix} OR title ILIKE $${prefix} THEN 1
                              WHEN ${tail} ILIKE $${like} OR title ILIKE $${like} THEN 2
                              WHEN server_name ILIKE $${like} THEN 3 ELSE 4 END, server_name`;
            }
        }
        const cond = where.join(' AND ');
        // 순위용 파라미터는 COUNT 에 쓰지 않는다 — 조건에 쓰인 것까지만 넘긴다(미사용 파라미터는 pg 가 타입을 못 정한다)
        const condParams = opts.search && opts.rank ? params.slice(0, -2) : params;
        const count = await this.db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM market_registry_entries WHERE ${cond}`, condParams);
        params.push(opts.limit, opts.offset);
        const r = await this.db.query<EntryRow>(
            `SELECT ${ENTRY_COLUMNS} FROM market_registry_entries WHERE ${cond}
              ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params,
        );
        return { entries: r.rows.map(toEntry), total: Number(count.rows[0]?.n ?? 0) };
    }

    async get(serverName: string): Promise<StoredRegistryEntry | null> {
        const r = await this.db.query<EntryRow>(
            `SELECT ${ENTRY_COLUMNS} FROM market_registry_entries WHERE source_id = $1 AND server_name = $2`,
            [this.sourceId, serverName],
        );
        return r.rows[0] ? toEntry(r.rows[0]) : null;
    }

    /** 큐레이션 — 지워진(tombstone) 항목은 승인할 수 없다. 바뀐 행이 없으면 false */
    async setCuration(serverName: string, curation: Curation, by: string): Promise<boolean> {
        const r = await this.db.query(
            `UPDATE market_registry_entries SET curation = $3, curated_by = $4, curated_at = NOW()
              WHERE source_id = $1 AND server_name = $2 AND (tombstoned_at IS NULL OR $3 <> 'approved')`,
            [this.sourceId, serverName, curation, by],
        );
        return (r.rowCount ?? 0) > 0;
    }

    async setPromoted(serverName: string, catalogId: string): Promise<void> {
        await this.db.query(
            `UPDATE market_registry_entries SET promoted_catalog_id = $3 WHERE source_id = $1 AND server_name = $2`,
            [this.sourceId, serverName, catalogId],
        );
    }

    async counts(): Promise<Record<Curation | 'tombstoned', number>> {
        const r = await this.db.query<{ curation: Curation; tomb: boolean; n: string }>(
            `SELECT curation, tombstoned_at IS NOT NULL AS tomb, COUNT(*)::text AS n FROM market_registry_entries
              WHERE source_id = $1 GROUP BY 1, 2`,
            [this.sourceId],
        );
        const out = { pending: 0, approved: 0, hidden: 0, tombstoned: 0 };
        for (const row of r.rows) {
            if (row.tomb) out.tombstoned += Number(row.n);
            else out[row.curation] += Number(row.n);
        }
        return out;
    }

    async getState(): Promise<SyncState> {
        const r = await this.db.query<Record<string, unknown>>(
            `SELECT cursor, run_updated_since, run_started_at, watermark, last_attempt_at, last_success_at, backoff_until,
                    failure_count, last_error, last_stats
               FROM market_registry_sync_state WHERE source_id = $1`,
            [this.sourceId],
        );
        const row = r.rows[0];
        if (!row) {
            return {
                cursor: null, runUpdatedSince: null, runStartedAt: null, watermark: null, lastAttemptAt: null,
                lastSuccessAt: null, backoffUntil: null, failureCount: 0, lastError: null, lastStats: {},
            };
        }
        return {
            cursor: (row.cursor as string | null) ?? null,
            runUpdatedSince: iso(row.run_updated_since as Date | null),
            runStartedAt: iso(row.run_started_at as Date | null),
            watermark: iso(row.watermark as Date | null),
            lastAttemptAt: iso(row.last_attempt_at as Date | null),
            lastSuccessAt: iso(row.last_success_at as Date | null),
            backoffUntil: iso(row.backoff_until as Date | null),
            failureCount: Number(row.failure_count ?? 0),
            lastError: (row.last_error as string | null) ?? null,
            lastStats: (row.last_stats as Record<string, number> | null) ?? {},
        };
    }

    async patchState(patch: SyncStatePatch): Promise<void> {
        const keys = (Object.keys(patch) as Array<keyof SyncState>).filter(k => patch[k] !== undefined);
        if (keys.length === 0) return;
        const cols = keys.map(k => STATE_COLUMNS[k]);
        const vals = keys.map(k => (k === 'lastStats' ? JSON.stringify(patch[k]) : patch[k]));
        const placeholders = keys.map((k, i) => (k === 'lastStats' ? `$${i + 2}::jsonb` : `$${i + 2}`));
        await this.db.query(
            `INSERT INTO market_registry_sync_state (source_id, ${cols.join(', ')}, updated_at)
             VALUES ($1, ${placeholders.join(', ')}, NOW())
             ON CONFLICT (source_id) DO UPDATE SET ${cols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = NOW()`,
            [this.sourceId, ...vals],
        );
    }
}
