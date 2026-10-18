"use client";

/**
 * 관리자 화면 role 가드 — 정적 관리자 화면은 admin/layout.tsx 가, add-on 관리자 화면은 catch-all 페이지가 감싼다.
 *
 * 그전엔 관리자 페이지에 페이지 수준 가드가 없어 비관리자도 URL 로 도달했고, 막는 것은
 * 관리자 API 의 401 뿐이었다(→ 빈 화면 또는 과거엔 목업이 실렌더). 여기서 역할을 판정해
 * 비관리자에겐 안내만 보여준다.
 *
 * auth 는 마운트 후 /api/auth/me 로 비동기 동기화되므로 `authResolved` 전엔 판정을 미룬다 —
 * 미루지 않으면 새로고침 직후 관리자에게도 "권한 없음"이 번쩍인다.
 * ⚠️ 그래서 SSR 에서는 children 을 그리지 않는다 — 이 가드 안에서 던진 notFound() 는 응답 상태(404)에 닿지 않는다.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, ShieldOff } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/primitives";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin.guard");
  const authResolved = useAppStore((s) => s.authResolved);
  const role = useAppStore((s) => s.auth.currentUser?.role);

  if (!authResolved) {
    return (
      <div className="grid h-full place-items-center text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (role !== "admin") {
    return (
      <div className="grid h-full place-items-center p-6">
        <Card className="max-w-md p-6 text-center">
          <ShieldOff className="mx-auto mb-3 h-8 w-8 text-faint" />
          <p className="text-sm font-medium text-fg">{t("denied")}</p>
          <p className="mt-1 text-xs text-muted">{t("deniedDescription")}</p>
          <Link href="/" className="mt-4 inline-block text-xs font-medium text-accent hover:underline">
            {t("home")}
          </Link>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
