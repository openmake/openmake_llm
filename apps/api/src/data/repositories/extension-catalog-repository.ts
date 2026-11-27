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

interface CatalogPluginEntry {
    name: string;
    description?: string;
    version?: string;
    /** 동기화 시점 사전 판정 — 스킬/MCP 서버 보유 여부. undefined = 판정 미상(교차 저장소 등) */
    installable?: boolean;
    /** 마켓플레이스 분류 (marketplace.json category — 카탈로그 UI 필터용) */
    category?: string;
    /** 설명 한국어 번역 (동기화 후단 배치 — catalog-translator.ts, 없으면 원문 노출) */
    description_ko?: string;
    /** 교차 저장소 항목의 실제 원본 URL(marketplace.json 항목 url) — 원본 정책 catalog-only 판정. 이 필드 이전 스냅샷은 재동기화로 채워진다 */
    source?: string;
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
    /** M5 이름 설치 별칭 (207). null = 스냅샷 name */
    alias?: string | null;
    /** 원본 접근 토큰 암호문 (207, write-only) — ⚠️ 응답에 싣지 말 것(toPublicCatalogSource) */
    credential_encrypted?: string | null;
    /** 저장소 안 카탈로그 루트 (207). null = 저장소 루트 */
    source_subpath?: string | null;
    /** M6 정적 색인 주소 (207, 예약) */
    index_url?: string | null;
    /** 마지막 동기화 결과 (207). null = 기록 없음 */
    sync_status?: 'ok' | 'error' | 'rate_limited' | null;
    last_sync_error?: string | null;
    last_sync_attempt_at?: Date | null;
}

/** 응답용 — 암호문을 빼고 저장 여부만 알린다 (write-only 자격증명) */
export type PublicCatalogSource = Omit<ExtensionCatalogRow, 'credential_encrypted'> & { has_credential: boolean };

export function toPublicCatalogSource(row: ExtensionCatalogRow): PublicCatalogSource {
    const { credential_encrypted: cred, ...rest } = row;
    return { ...rest, has_credential: typeof cred === 'string' && cred.length > 0 };
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

    /** 원본 접근 토큰 저장·삭제 (암호문 — 암호화는 호출측 token-crypto). null = 삭제 */
    async setCredential(id: string, encrypted: string | null): Promise<boolean> {
        const r = await this.query(
            `UPDATE extension_catalog_sources SET credential_encrypted=$1, updated_at=NOW() WHERE id=$2`,
            [encrypted, id]
        );
        return (r.rowCount ?? 0) > 0;
    }

    /** 하위 경로 지정 (null = 저장소 루트) */
    async setSubpath(id: string, subpath: string | null): Promise<ExtensionCatalogRow | null> {
        const r = await this.query<ExtensionCatalogRow>(
            `UPDATE extension_catalog_sources SET source_subpath=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
            [subpath, id]
        );
        return r.rows[0] ?? null;
    }

    /**
     * 이름 설치 별칭 지정 (M5). 다른 원본이 이미 쓰는 별칭이면 null 을 돌려준다(UNIQUE 위반 — 호출측이 409).
     * `onlyIfUnset` 이면 별칭이 비어 있을 때만 채운다(등록·동기화 시 스냅샷 name 기본값).
     */
    async setAlias(id: string, alias: string | null, opts: { onlyIfUnset?: boolean } = {}): Promise<{ row: ExtensionCatalogRow | null; conflict: boolean }> {
        try {
            const r = await this.query<ExtensionCatalogRow>(
                `UPDATE extension_catalog_sources SET alias=$1, updated_at=NOW()
                 WHERE id=$2 ${opts.onlyIfUnset ? 'AND alias IS NULL' : ''} RETURNING *`,
                [alias, id]
            );
            return { row: r.rows[0] ?? null, conflict: false };
        } catch (err) {
            if ((err as { code?: string })?.code === '23505') return { row: null, conflict: true };
            throw err;
        }
    }

    /** 동기화 시도 결과 기록 — 성공이면 사유를 지운다. 스냅샷(last_synced_at)은 updateSnapshot 이 따로 갱신 */
    async recordSyncResult(id: string, status: 'ok' | 'error' | 'rate_limited', error: string | null): Promise<void> {
        await this.query(
            `UPDATE extension_catalog_sources
                SET sync_status=$1, last_sync_error=$2, last_sync_attempt_at=NOW()
              WHERE id=$3`,
            [status, status === 'ok' ? null : error, id]
        );
    }

    async remove(id: string): Promise<boolean> {
        const r = await this.query(
            `DELETE FROM extension_catalog_sources WHERE id=$1`,
            [id]
        );
        return (r.rowCount ?? 0) > 0;
    }
}
