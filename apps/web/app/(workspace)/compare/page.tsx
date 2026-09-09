import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CompareView } from "@/components/chat/compare-view";

/** 모델 비교 모드 페이지 — 두 모델이 같은 질문에 동시에 답한다. (2026-09-09) */
export default async function ComparePage() {
  const t = await getTranslations("compare");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-fg">{t("title")}</h1>
          <p className="truncate text-xs text-faint">{t("subtitle")}</p>
        </div>
        <Link
          href="/"
          className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          {t("backToChat")}
        </Link>
      </header>

      <CompareView />
    </div>
  );
}
