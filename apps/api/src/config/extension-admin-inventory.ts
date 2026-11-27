/**
 * 관리자 확장 현황(마켓플레이스 남은 개발계획 v3.7 M3) — 노출 플래그·페이지 상한.
 *
 * `EXTENSION_ADMIN_INVENTORY_ENABLED`(기본 OFF): OFF 면 현황·정책 미리보기 라우트가 404 이고 웹 탭이 숨는다
 * (상태 조회 `GET /api/admin/extensions/status` 만 응답). 관리자 설정에서 바로 바뀐다(overlay > env — getConfig 가 overlay 를 반영).
 *
 * @module config/extension-admin-inventory
 */
import { getConfig } from './env';

export const EXTENSION_ADMIN_INVENTORY_KEY = 'EXTENSION_ADMIN_INVENTORY_ENABLED';

export const EXTENSION_ADMIN_INVENTORY_LIMITS = {
    /** 현황 한 페이지 기본 행 수 */
    PAGE_DEFAULT: 50,
    /** 현황 한 페이지 최대 행 수 */
    PAGE_MAX: 100,
    /** 검색어 최대 길이 */
    QUERY_MAX_CHARS: 200,
    /** 원본별 집계 최대 행 수 */
    SOURCE_SUMMARY_MAX: 200,
    /** 정책 미리보기가 한 번에 판정하는 설치 확장 상한(넘으면 truncated 표시) */
    PREVIEW_MAX: 5000,
} as const;

export function isExtensionAdminInventoryEnabled(): boolean {
    return getConfig().extensionAdminInventoryEnabled;
}
