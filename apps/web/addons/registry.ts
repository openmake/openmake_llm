/**
 * 웹 add-on 레지스트리 — 이 빌드에 포함된 add-on UI 확장. Base 는 여기만 import 한다.
 * 서버에서 꺼진 add-on(`GET /api/addons` 의 enabled=false)은 `useEnabledWebAddons` 가 걸러 낸다.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiClient } from "@/lib/api-client";
import { discordAddon } from "./discord";
import { kakaoMapAddon } from "./kakao-map";
import { notebooklmAddon } from "./notebooklm";
import type { WebAddon } from "./types";

export const WEB_ADDONS: readonly WebAddon[] = [kakaoMapAddon, notebooklmAddon, discordAddon];

/**
 * 서버에서 켜져 있는 add-on 만. 조회 실패·로딩 중에는 전부 켜진 것으로 본다(fail-open) —
 * 라우트가 없는 배포에서 진입점이 보이는 것보다, 일시 오류로 기능이 사라지는 쪽이 더 나쁘다.
 */
export function useEnabledWebAddons(): readonly WebAddon[] {
  const { data } = useQuery({
    queryKey: ["addons"],
    queryFn: () => ApiClient.get<{ data: { addons: { id: string; enabled: boolean }[] } }>("/api/addons"),
    staleTime: Infinity,
  });
  // 같은 응답이면 같은 배열을 돌려준다 — 호출부의 useMemo 의존성이 렌더마다 바뀌지 않게
  return useMemo(() => {
    const disabled = new Set((data?.data?.addons ?? []).filter((a) => !a.enabled).map((a) => a.id));
    return disabled.size === 0 ? WEB_ADDONS : WEB_ADDONS.filter((a) => !disabled.has(a.id));
  }, [data]);
}
