/**
 * 큐레이션 add-on 라우터 진입점 — 매니페스트 `entry.routes` 가 이름으로 찾는다(`routes#<export>`).
 *
 * @module addons/extension-curation/routes
 */
import { createGalleryRouter, createVisibilityRouter } from './gallery-routes';
import { createMarketplacePublishRouter } from './publish-routes';

export const galleryRouter = createGalleryRouter();
export const visibilityRouter = createVisibilityRouter();
export const marketplacePublishRouter = createMarketplacePublishRouter();
