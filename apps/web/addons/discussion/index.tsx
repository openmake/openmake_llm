/**
 * discussion add-on (웹) — 토론 모드 토글과 진행 배너(단계·발언 에이전트·라운드·진행률).
 */
"use client";

import { MessagesSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import type { WebAddon } from "../types";
import { ModeProgressFrame, clampPercent } from "../progress-banner";

/** 백엔드 discussion_progress 이벤트의 progress (DiscussionProgress 대응) */
interface DiscussionProgressInfo {
  phase?: string;
  currentAgent?: string;
  agentEmoji?: string;
  message: string;
  progress: number;
  roundNumber?: number;
  totalRounds?: number;
}

function ProgressBanner({ progress }: { progress: unknown }) {
  const t = useTranslations("chat");
  const dp = progress as DiscussionProgressInfo;
  return (
    <ModeProgressFrame
      Icon={MessagesSquare}
      title={t("discussion.inProgress")}
      extras={
        <>
          {dp.currentAgent && (
            <span className="text-faint">· {dp.agentEmoji ? `${dp.agentEmoji} ` : ""}{dp.currentAgent}</span>
          )}
          {dp.totalRounds != null && dp.totalRounds > 0 && dp.roundNumber != null && (
            <span className="text-faint">· {t("discussion.round", { current: dp.roundNumber, total: dp.totalRounds })}</span>
          )}
        </>
      }
      message={dp.message}
      progress={dp.progress}
    />
  );
}

export const discussionAddon: WebAddon = {
  id: "discussion",
  chatMode: {
    Icon: MessagesSquare,
    labelKey: "toggle.discussion",
    toggleOrder: 10,
    analyticsName: "discussion",
    progressEventType: "discussion_progress",
    toProgress: (p): DiscussionProgressInfo => ({
      phase: typeof p.phase === "string" ? p.phase : undefined,
      currentAgent: typeof p.currentAgent === "string" ? p.currentAgent : undefined,
      agentEmoji: typeof p.agentEmoji === "string" ? p.agentEmoji : undefined,
      message: typeof p.message === "string" ? p.message : "",
      progress: clampPercent(p.progress),
      roundNumber: typeof p.roundNumber === "number" ? p.roundNumber : undefined,
      totalRounds: typeof p.totalRounds === "number" ? p.totalRounds : undefined,
    }),
    ProgressBanner,
  },
};
