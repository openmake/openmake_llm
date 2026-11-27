/**
 * 카탈로그 원본의 이름 설치 별칭 기본값 (M5) — 별칭이 비어 있으면 스냅샷 `name` 으로 채운다.
 *
 * 규칙에 맞지 않거나(문자·예약어) 다른 원본이 이미 그 별칭을 쓰면 비워 둔다 — 관리자가 PATCH 로 지정한다.
 * 실패는 삼킨다(등록·동기화를 막지 않는다).
 *
 * @module services/extensions/catalog-alias
 */
import { createLogger } from '../../utils/logger';
import { isValidMarketplaceAlias } from '../../config/extension-named-install';
import type { ExtensionCatalogRow } from '../../data/repositories/extension-catalog-repository';

const logger = createLogger('ExtensionCatalogAlias');

export interface CatalogAliasRepo {
    setAlias(id: string, alias: string | null, opts?: { onlyIfUnset?: boolean }): Promise<{ row: ExtensionCatalogRow | null; conflict: boolean }>;
}

export async function applyDefaultCatalogAlias(repo: CatalogAliasRepo, row: ExtensionCatalogRow): Promise<ExtensionCatalogRow> {
    if (row.alias || !row.name || !isValidMarketplaceAlias(row.name)) return row;
    try {
        const r = await repo.setAlias(row.id, row.name, { onlyIfUnset: true });
        if (r.conflict) logger.info(`카탈로그 별칭 기본값 충돌 — 비워 둠 (${row.id}, "${row.name}")`);
        return r.row ?? row;
    } catch (e) {
        logger.warn(`카탈로그 별칭 기본값 저장 실패 (${row.id}):`, e);
        return row;
    }
}
