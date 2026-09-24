"use client";

import { useAppStore } from "@/lib/store";
import { useEnabledWebAddons } from "@/addons/registry";

/** 열린 대화의 add-on 배너 슬롯 — Base 는 어떤 add-on 인지 모르고 레지스트리를 순회만 한다 */
export function ChatContextBanners() {
  const sessionId = useAppStore((s) => s.currentSessionId);
  const banners = useEnabledWebAddons()
    .flatMap((a) => a.chatContextBanners ?? [])
    .slice()
    .sort((a, b) => a.order - b.order);
  if (banners.length === 0) return null;
  return (
    <>
      {banners.map((b, i) => (
        <b.Component key={i} sessionId={sessionId} />
      ))}
    </>
  );
}
