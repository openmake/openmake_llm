/**
 * 웹 add-on 켜짐 필터 — `useEnabledWebAddons`(registry.ts)의 순수 판정. React·화면을 import 하지 않아 api Jest 에서도 검증한다.
 */
import type { WebAddon } from "./types";

/**
 * PURE: 목록 응답(없으면 로딩 중·실패) → 보일 add-on. 숨길 것이 없으면 입력 배열을 그대로 돌려준다(참조 유지).
 * 종전 add-on 은 응답에서 꺼짐으로 온 것만 빠지고, `hideUntilEnabledKnown` add-on 은 켜짐으로 온 것만 남는다.
 */
export function selectEnabledWebAddons(
  addons: readonly WebAddon[],
  states: readonly { id: string; enabled: boolean }[] | undefined,
): readonly WebAddon[] {
  const enabled = new Set((states ?? []).filter((a) => a.enabled).map((a) => a.id));
  const disabled = new Set((states ?? []).filter((a) => !a.enabled).map((a) => a.id));
  const visible = (a: WebAddon) => (a.hideUntilEnabledKnown ? enabled.has(a.id) : !disabled.has(a.id));
  return addons.every(visible) ? addons : addons.filter(visible);
}
