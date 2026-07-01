"use client";

import { FileCode2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAppStore } from "@/lib/store";

/** 아티팩트가 있고 패널이 닫혀 있을 때만 노출 — 클릭 시 패널 재오픈. */
export function ArtifactToggle() {
  const t = useTranslations("artifacts");
  const count = useAppStore((s) => s.artifacts.length);
  const open = useAppStore((s) => s.artifactPanelOpen);
  const setOpen = useAppStore((s) => s.setArtifactPanelOpen);

  if (count === 0 || open) return null;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg-2 transition hover:bg-surface-3 hover:text-fg"
    >
      <FileCode2 className="h-3.5 w-3.5" />
      {t("artifactCount", { count })}
    </button>
  );
}
