/**
 * deep-research add-on (웹) — 딥리서치 모드 토글과 진행 배너(단계·진행률·루프).
 */
"use client";

import { Telescope } from "lucide-react";
import { useTranslations } from "next-intl";
import type { WebAddon } from "../types";
import { ModeProgressFrame, clampPercent } from "../progress-banner";

/** 백엔드 research_progress 이벤트의 progress (ResearchProgress 대응) */
interface ResearchProgressInfo {
  currentStep: string;
  progress: number;
  message: string;
  currentLoop: number;
  totalLoops: number;
}

function ProgressBanner({ progress }: { progress: unknown }) {
  const t = useTranslations("chat");
  const rp = progress as ResearchProgressInfo;
  return (
    <ModeProgressFrame
      Icon={Telescope}
      title={t("research.inProgress")}
      extras={rp.totalLoops > 0 && (
        <span className="text-faint">· {t("research.loop", { current: rp.currentLoop, total: rp.totalLoops })}</span>
      )}
      message={rp.message}
      progress={rp.progress}
      progressSuffix={rp.currentStep ? ` · ${rp.currentStep}` : ""}
    />
  );
}

export const deepResearchAddon: WebAddon = {
  id: "deep-research",
  // 화면(`/research`)은 pages/index.tsx → addons/pages.ts 에 등록한다. 진입점은 히스토리 허브의 탭(대화 히스토리 다음)
  hubTabs: [{ hub: "history", href: "/research", labelKey: "pageTabs.research", order: 20 }],
  chatMode: {
    Icon: Telescope,
    labelKey: "toggle.deepResearch",
    toggleOrder: 40,
    analyticsName: "deep_research",
    progressEventType: "research_progress",
    toProgress: (p): ResearchProgressInfo => ({
      currentStep: typeof p.currentStep === "string" ? p.currentStep : "",
      progress: clampPercent(p.progress),
      message: typeof p.message === "string" ? p.message : "",
      currentLoop: typeof p.currentLoop === "number" ? p.currentLoop : 0,
      totalLoops: typeof p.totalLoops === "number" ? p.totalLoops : 0,
    }),
    ProgressBanner,
  },
};
