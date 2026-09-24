"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Cpu } from "lucide-react";
import { fetchModels } from "@/lib/models-api";
import { useAppStore } from "@/lib/store";

/**
 * 실제로 답한(처리한) 모델 배지 — 선택 모델이 아니라 서버가 알려준 served model(자동 선택·쿼터 강등·폴백 반영).
 * 카탈로그(/api/models, 컴포저와 같은 캐시 키)에 표시 이름이 있으면 이름, 없으면 id 를 그대로 보인다.
 */
export function ServedModelBadge({ model, kind = "answer" }: { model: string; kind?: "answer" | "task" }) {
  const t = useTranslations("chat");
  const currentUserId = useAppStore((s) => s.auth.currentUser?.id ?? null);
  const { data } = useQuery({
    queryKey: ["models", "chat", currentUserId ?? "guest"],
    queryFn: () => fetchModels({ chatOnly: true }),
    staleTime: 60_000,
  });
  const label = data?.models.find((m) => m.modelId === model)?.name || model;
  const described = kind === "task" ? t("orchestrator.taskModel", { model: label }) : t("servedModel", { model: label });
  return (
    <span
      className="inline-flex min-w-0 max-w-[16rem] shrink items-center gap-1 rounded border border-border px-1.5 py-px font-mono text-[11px] font-normal text-muted"
      title={label === model ? described : `${described} (${model})`}
    >
      <Cpu className="h-3 w-3 shrink-0" aria-hidden />
      <span className="sr-only">{described}</span>
      <span className="truncate" aria-hidden>
        {label}
      </span>
    </span>
  );
}
