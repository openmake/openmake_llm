"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, LoaderCircle } from "lucide-react";
import Image from "next/image";
import { ApiClient, ApiError } from "@/lib/api-client";
import { syncAuthFromServer } from "@/lib/auth-sync";
import { Button } from "@/components/ui/primitives";

export default function LoginPage() {
  const t = useTranslations("auth.login");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await ApiClient.post("/api/auth/login", { email, password });
      // router.push 는 remount 가 없어 AuthSync(마운트 1회)가 다시 돌지 않는다 —
      // 로그인 직후 store 동기화(+익명 세션 이관)를 직접 수행해야 사이드바가 즉시 반영.
      await syncAuthFromServer();
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  const guest = async () => {
    setLoading(true);
    try {
      await ApiClient.post("/api/auth/guest");
      // submit() 과 동일 — router.push 는 remount 가 없어 AuthSync(마운트 1회)가 다시
      // 돌지 않으므로, 게스트 진입 직후 store 를 직접 동기화해야 사이드바/인증 UI 가 즉시
      // 반영된다 (하드 리로드 전까지 게스트로 남던 버그 방지).
      await syncAuthFromServer();
    } catch {
      /* 게스트 실패해도 채팅은 익명 허용 */
    } finally {
      router.push("/");
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-app px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <Image
            src="/logo.png"
            alt="OpenMake"
            width={48}
            height={48}
            className="h-12 w-12 rounded-xl object-contain"
            priority
          />
          <h1 className="mt-4 text-2xl font-bold text-fg">OpenMake.Ai</h1>
          <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="rounded-xl border border-border bg-surface p-6 shadow-2"
        >
          {error && (
            <div className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          <label className="block text-xs font-medium text-fg-2">{t("emailLabel")}</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-[var(--accent-ring)]"
          />

          <label className="mt-4 block text-xs font-medium text-fg-2">
            {t("passwordLabel")}
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-[var(--accent-ring)]"
          />

          <Button type="submit" disabled={loading} className="mt-5 w-full">
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {t("submit")} <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-faint">{t("or")}</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a
              href="/api/auth/login/google"
              className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong bg-surface text-sm font-medium text-fg transition hover:bg-surface-2"
            >
              Google
            </a>
            <a
              href="/api/auth/login/github"
              className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong bg-surface text-sm font-medium text-fg transition hover:bg-surface-2"
            >
              GitHub
            </a>
          </div>

          <button
            type="button"
            onClick={guest}
            disabled={loading}
            className="mt-3 w-full text-center text-xs text-muted transition hover:text-fg"
          >
            {t("continueAsGuest")}
          </button>

          <p className="mt-4 text-center text-xs text-muted">
            {t("noAccount")}{" "}
            <Link href="/register" className="font-medium text-accent hover:underline">
              {t("signUp")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
