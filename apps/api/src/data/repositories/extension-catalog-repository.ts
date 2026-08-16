/**
 * extension_catalog_sources 저장소 — admin 큐레이션 확장 카탈로그.
 *
 * 등록/동기화/삭제는 admin 전용 (컨트롤러에서 requireAdmin), 조회는 전 사용자
 * (Settings 갤러리 카탈로그 섹션). plugins 는 fetchCatalogSnapshot 스냅샷 전체 교체.
 *
 * @module data/repositories/extension-catalog-repository
 */
import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './base-repository';

export interface CatalogPluginEntry {
    name: string;
    description?: string;
    version?: string;
    /** 동기화 시점 사전 판정 — 스킬/MCP 서버 보유 여부. undefined = 판정 미상(교차 저장소 등) */
    installable?: boolean;
}

export interface ExtensionCatalogRow {
    id: string;
    url: string;
    name: string;
    description: string | null;
    plugins: CatalogPluginEntry[];
    enabled: boolean;
    added_by: string | null;
    last_synced_at: Date;
    created_at: Date;
    updated_at: Date;
}

export class ExtensionCatalogRepository extends BaseRepository {
    async insert(input: {
        url: string;
        name: string;
        description?: string | null;
        plugins: CatalogPluginEntry[];
        addedBy: string;
    }): Promise<ExtensionCatalogRow> {
        const id = `ext-cat-${uuidv4()}`;
        const r = await this.query<ExtensionCatalogRow>(
            `INSERT INTO extension_catalog_sources (id, url, name, description, plugins, added_by)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)
             RETURNING *`,
            [id, input.url, input.name, input.description ?? null, JSON.stringify(input.plugins), input.addedBy]
        );
        return r.rows[0];
    }

    async getById(id: string): Promise<ExtensionCatalogRow | null> {
        const r = await this.query<ExtensionCatalogRow>(
            `SELECT * FROM extension_catalog_sources WHERE id=$1 LIMIT 1`,
            [id]
        );
        return r.rows[0] ?? null;
    }

    async findByUrl(url: string): Promise<ExtensionCatalogRow | null> {
        const r = await this.query<ExtensionCatalogRow>(
            `SELECT * FROM extension_catalog_sources WHERE url=$1 LIMIT 1`,
            [url]
        );
        return r.rows[0] ?? null;
    }

    /** 전체 목록 (admin 관리용 — enabled 무관). */
    async listAll(): Promise<ExtensionCatalogRow[]> {
        const r = await this.query<ExtensionCatalogRow>(
            `SELECT * FROM extension_catalog_sources ORDER BY created_at DESC`
        );
        return r.rows;
    }

    /** 갤러리 노출 목록 (enabled 만). */
    async listEnabled(): Promise<ExtensionCatalogRow[]> {
        const r = await this.query<ExtensionCatalogRow>(
            `SELECT * FROM extension_catalog_sources WHERE enabled=TRUE ORDER BY created_at DESC`
        );
        return r.rows;
    }

    /** 동기화 — 스냅샷 전체 교체. */
    async updateSnapshot(id: string, input: {
        name: string;
        description?: string | null;
        plugins: CatalogPluginEntry[];
    }): Promise<ExtensionCatalogRow | null> {
        const r = await this.query<ExtensionCatalogRow>(
            `UPDATE extension_catalog_sources
                SET name=$1, description=$2, plugins=$3::jsonb, last_synced_at=NOW(), updated_at=NOW()
              WHERE id=$4
              RETURNING *`,
            [input.name, input.description ?? null, JSON.stringify(input.plugins), id]
        );
        return r.rows[0] ?? null;
    }

    async remove(id: string): Promise<boolean> {
        const r = await this.query(
            `DELETE FROM extension_catalog_sources WHERE id=$1`,
            [id]
        );
        return (r.rowCount ?? 0) > 0;
    }
}
