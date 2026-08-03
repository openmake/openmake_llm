import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { House, FileQuestion } from "lucide-react";

// root not-found 는 root layout(NextIntlClientProvider) 안에서 렌더되는 서버 컴포넌트라
// 번역이 정상 동작한다. 정상 경로이므로 error/global-error 와 달리 번역 키를 사용한다.
export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <div className="grid min-h-dvh place-items-center bg-app px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-surface-3 text-muted">
          <FileQuestion className="h-6 w-6" />
        </div>
        <p className="mt-4 font-mono text-4xl font-bold tracking-tight text-fg">404</p>
        <h1 className="mt-2 text-lg font-bold text-fg">{t("title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("description")}</p>
        <div className="mt-6 flex items-center justify-center">
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg shadow-2 transition hover:bg-accent-hover active:bg-accent-press"
          >
            <House className="h-4 w-4" />
            {t("backHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}
