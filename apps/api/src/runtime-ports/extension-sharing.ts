/**
 * 확장 공유·게시 포트 (§8-2 큐레이션 add-on 이전, 2026-11-28) — 큐레이션 add-on 의 갤러리·공유 토글·내부 게시 라우트가
 * Base 확장 저장소와 설치 엔진을 쓰는 문.
 *
 * 저장소(`user_extensions`·카탈로그 원본·`marketplace_bundles`)·설치 엔진(`git-ingest`)·원본 정책(M2)은 Base 에 남는다 —
 * 채팅 설치·이름 설치·조직 배포 모드·다른 add-on 이 쓰고, add-on 을 꺼도 정책이 강제돼야 하기 때문이다(계획서 원칙 3).
 * add-on 은 HTTP 계층(검증·응답 모양·흐름)만 가진다. 연산은 호출마다 공용 풀에 묶인 저장소를 새로 만든다(종전 라우트와 같다).
 *
 * @module runtime-ports/extension-sharing
 */
import { getPool } from '../data/models/unified-database';
import { UserExtensionRepository } from '../data/repositories/user-extension-repository';
import { ExtensionCatalogRepository } from '../data/repositories/extension-catalog-repository';
import { MarketplaceExportRepository } from '../data/repositories/marketplace-export-repository';
import { MarketplaceBundleRepository } from '../data/repositories/marketplace-bundle-repository';

export type { UserExtensionRow, ExtensionVisibility } from '../data/repositories/user-extension-repository';
export { toPublicExtension, memberOrgIds, requestUserId } from '../services/extensions/public-view';
export { installSharedExtension } from '../services/extensions/shared-install';
export { galleryDeploymentModes } from '../services/extensions/org-deployment';
export { activeOrgFor } from '../services/org/membership-cache';
export { ExtensionSourceBlockedError } from '../errors/extension-source-blocked.error';
export { buildPluginBundle, validatePluginName } from '../services/marketplace/plugin-bundle-builder';
export { INTERNAL_BUNDLE_PREFIX } from '../agents/git-ingest/internal-bundle-fetcher';

/** 사용자 확장 저장소 — 공유 목록·설치 판정·공개범위·게시 행 */
export function userExtensionStore(): UserExtensionRepository {
    return new UserExtensionRepository(getPool());
}

/** 큐레이션 카탈로그 원본 저장소 — 갤러리는 `listEnabled` 만 쓴다 */
export function catalogSourceStore(): ExtensionCatalogRepository {
    return new ExtensionCatalogRepository(getPool());
}

/** 게시 후보·구성요소 읽기 */
export function marketplaceExportStore(): MarketplaceExportRepository {
    return new MarketplaceExportRepository(getPool());
}

/** 내부 게시 번들 저장 */
export function marketplaceBundleStore(): MarketplaceBundleRepository {
    return new MarketplaceBundleRepository(getPool());
}
