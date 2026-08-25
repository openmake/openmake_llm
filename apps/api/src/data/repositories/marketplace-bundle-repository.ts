/**
 * 내부 마켓플레이스 번들 저장소 (marketplace_bundles, 105).
 *
 * 번들 = 플러그인 규격 파일 묶음. 원본 바이트를 base64 로 보존한다(스킬 번들 스크립트 등).
 * 소유자×이름이 유일 — 같은 이름 재게시는 갱신(sha 가 바뀌면 갤러리 설치본의 update-check 가 잡는다).
 *
 * @module data/repositories/marketplace-bundle-repository
 */
import type { Pool } from 'pg';
import { createHash, randomUUID } from 'crypto';
import type { LoadedBundle } from '../../agents/git-ingest/internal-bundle-fetcher';

export interface BundleFileRecord { path: string; encoding: 'utf8' | 'base64'; content: string }

export interface UpsertBundleInput {
    ownerId: string;
    name: string;
    version: string;
    description?: string;
    category?: string;
    files: Array<{ path: string; content: string | Buffer }>;
}

export interface MarketplaceBundleRow {
    id: string; owner_id: string; name: string; version: string; description: string | null;
    category: string | null; sha: string; total_bytes: number; created_at: Date; updated_at: Date;
}

/** 결정적 sha — 같은 파일 집합이면 같은 값 (업데이트 판정의 기준) */
export function bundleSha(files: Array<{ path: string; content: string | Buffer }>): string {
    const h = createHash('sha256');
    for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
        h.update(f.path).update('\0').update(typeof f.content === 'string' ? Buffer.from(f.content) : f.content).update('\0');
    }
    return h.digest('hex');
}

export class MarketplaceBundleRepository {
    constructor(private readonly pool: Pool) {}

    async upsert(input: UpsertBundleInput): Promise<MarketplaceBundleRow> {
        const records: BundleFileRecord[] = input.files.map((f) => Buffer.isBuffer(f.content)
            ? { path: f.path, encoding: 'base64', content: f.content.toString('base64') }
            : { path: f.path, encoding: 'utf8', content: f.content });
        const total = input.files.reduce((n, f) => n + (Buffer.isBuffer(f.content) ? f.content.length : Buffer.byteLength(f.content)), 0);
        const sha = bundleSha(input.files);
        const r = await this.pool.query<MarketplaceBundleRow>(
            `INSERT INTO marketplace_bundles (id, owner_id, name, version, description, category, sha, files, total_bytes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
             ON CONFLICT (owner_id, name) DO UPDATE
                SET version = EXCLUDED.version, description = EXCLUDED.description, category = EXCLUDED.category,
                    sha = EXCLUDED.sha, files = EXCLUDED.files, total_bytes = EXCLUDED.total_bytes, updated_at = NOW()
             RETURNING id, owner_id, name, version, description, category, sha, total_bytes, created_at, updated_at`,
            [`bundle-${randomUUID()}`, input.ownerId, input.name, input.version, input.description ?? null, input.category ?? null,
             sha, JSON.stringify(records), total],
        );
        return r.rows[0];
    }

    /** InternalBundleFetcher 용 로더 — 파일 맵으로 되돌린다 */
    async load(id: string): Promise<LoadedBundle | null> {
        const r = await this.pool.query<{ sha: string; files: BundleFileRecord[] }>(
            `SELECT sha, files FROM marketplace_bundles WHERE id = $1`, [id]);
        const row = r.rows[0];
        if (!row) return null;
        const files = new Map<string, Uint8Array>();
        for (const f of row.files) {
            files.set(f.path, f.encoding === 'base64' ? new Uint8Array(Buffer.from(f.content, 'base64')) : new Uint8Array(Buffer.from(f.content, 'utf8')));
        }
        return { sha: row.sha, files };
    }

    async getByOwnerAndName(ownerId: string, name: string): Promise<MarketplaceBundleRow | null> {
        const r = await this.pool.query<MarketplaceBundleRow>(
            `SELECT id, owner_id, name, version, description, category, sha, total_bytes, created_at, updated_at
               FROM marketplace_bundles WHERE owner_id = $1 AND name = $2`, [ownerId, name]);
        return r.rows[0] ?? null;
    }
}
