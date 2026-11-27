/**
 * 확장 카탈로그·설치본 읽기 전용 조회 — Base 포트(`runtime-ports/extension-catalog.ts`)가 쓴다 (M1 갤러리 판정, 2026-11-27).
 *
 * add-on 은 `extension_catalog_sources`·`user_extensions` 를 직접 읽지 않고 포트를 거친다.
 * 설치본 조회는 원본 URL 별 **이름당 최신 1건**만 — 사용자 id 는 돌려주지 않는다(판정 근거로만 쓴다).
 *
 * @module data/extension-catalog-lookup
 */
import { getPool } from './models/unified-database';

export interface CatalogSourceLookupRow {
    id: string;
    url: string;
    name: string;
    enabled: boolean;
    plugins: unknown;
    last_synced_at: Date | string | null;
}

export interface InstalledExtensionLookupRow {
    name: string;
    version: string;
    source_url: string;
    source_ref: string;
    source_path: string;
    manifest: unknown;
    updated_at: Date | string;
}

/** 판정 근거로 읽는 설치본 상한 — 한 카탈로그 요청당 */
export const INSTALLED_EVIDENCE_ROW_LIMIT = 2000;

export async function getCatalogSourceRow(id: string): Promise<CatalogSourceLookupRow | null> {
    const r = await getPool().query<CatalogSourceLookupRow>(
        'SELECT id, url, name, enabled, plugins, last_synced_at FROM extension_catalog_sources WHERE id = $1 LIMIT 1',
        [id],
    );
    return r.rows[0] ?? null;
}

/**
 * 원본 URL 들의 active 설치본 — (원본, 이름) 마다 가장 최근 것 하나.
 * 사람 소유 설치본만 근거로 쓴다 — 조직 소유 행(212, owner_org_id)은 구성요소 없는 갤러리 항목이라 근거가 아니다
 * (플래그 OFF 면 그런 행이 없어 결과는 종전과 같다).
 */
export async function listInstalledExtensionsBySources(sourceUrls: readonly string[]): Promise<InstalledExtensionLookupRow[]> {
    if (sourceUrls.length === 0) return [];
    const r = await getPool().query<InstalledExtensionLookupRow>(
        `SELECT DISTINCT ON (source_url, name) name, version, source_url, source_ref, source_path, manifest, updated_at
           FROM user_extensions
          WHERE status = 'active' AND owner_org_id IS NULL AND source_url = ANY($1::text[])
          ORDER BY source_url, name, updated_at DESC
          LIMIT $2`,
        [[...new Set(sourceUrls)], INSTALLED_EVIDENCE_ROW_LIMIT],
    );
    return r.rows;
}
