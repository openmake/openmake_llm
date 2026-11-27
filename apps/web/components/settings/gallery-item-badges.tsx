"use client";

import { useEnabledWebAddons } from "@/addons/registry";

/** 확장 갤러리 항목의 add-on 배지 슬롯 — Base 는 어떤 add-on 인지 모르고 레지스트리를 순회만 한다(없으면 아무것도 그리지 않는다) */
export function GalleryItemBadges({ catalogId, pluginName }: { catalogId: string; pluginName: string }) {
  const badges = useEnabledWebAddons()
    .flatMap((a) => a.galleryItemBadges ?? [])
    .slice()
    .sort((a, b) => a.order - b.order);
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map((b, i) => (
        <b.Component key={i} catalogId={catalogId} pluginName={pluginName} />
      ))}
    </>
  );
}
