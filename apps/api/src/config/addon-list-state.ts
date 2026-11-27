/**
 * add-on 목록의 DB 상태 반영(마켓플레이스 남은 개발계획 v3.7 §8-4) — 노출 플래그.
 *
 * `ADDON_LIST_REFLECT_DB_STATE`(기본 OFF): ON 이면 `GET /api/addons` 의 `enabled` 가 **모든** add-on 에 대해 라우트 게이트와
 * 같은 판정(`readAddonEnabledStrict` — env override × `addon_installations.state` × 이 프로세스의 준비 상태)을 쓴다.
 * OFF 면 종전 그대로 — 매니페스트 `defaultState` 를 선언한 add-on 만 DB 상태를 겹치고, 나머지는 env 판정만 본다
 * (관리자가 `/admin/addons` 에서 끈 add-on 도 목록엔 켜짐으로 나와 진입점이 남고 라우트는 404 였다).
 * 관리자 설정에서 바로 바뀐다(overlay > env — getConfig 가 overlay 를 반영).
 *
 * @module config/addon-list-state
 */
import { getConfig } from './env';

export const ADDON_LIST_REFLECT_DB_STATE_KEY = 'ADDON_LIST_REFLECT_DB_STATE';

export function isAddonListReflectDbStateEnabled(): boolean {
    return getConfig().addonListReflectDbState;
}
