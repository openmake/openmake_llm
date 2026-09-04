"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EXTERNAL_LINKS } from "@/lib/external-links";
import { ArrowRight, LoaderCircle } from "lucide-react";
import Image from "next/image";
import { ApiClient, ApiError } from "@/lib/api-client";
import { gaEvent, GA_EVENTS, markOAuthLoginPending } from "@/lib/analytics";
import { syncAuthFromServer } from "@/lib/auth-sync";
import { Button } from "@/components/ui/primitives";

export default function LoginPage() {
  const t = useTranslations("auth.login");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 웹 SSO 클라이언트(bench 등)에서 온 로그인: 성공 후 /api/auth/sso/authorize 로 돌아가 exchange code 를 받는다.
  // 마운트 후에 읽어 hydration 불일치를 피한다. 식별자만 허용 (redirect 목적지는 서버 화이트리스트).
  const [ssoClient, setSsoClient] = useState<string | null>(null);
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("client");
    setSsoClient(c && /^[a-z][a-z0-9_-]{0,31}$/.test(c) ? c : null);
  }, []);
  const ssoQuery = ssoClient ? `?client=${encodeURIComponent(ssoClient)}` : "";
  const afterLogin = () => {
    if (ssoClient) window.location.assign(`/api/auth/sso/authorize${ssoQuery}`);
    else router.push("/");
  };

  // 첫 실행(admin 0명)이면 셋업 마법사로 유도 — 실패 시 로그인 폼 그대로 (fail-open)
  useEffect(() => {
    void (async () => {
      try {
        const r = await ApiClient.get<{ data?: { setupNeeded?: boolean } }>("/api/setup/status");
        if (r?.data?.setupNeeded) router.replace("/setup");
      } catch {
        /* noop */
      }
    })();
  }, [router]);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await ApiClient.post("/api/auth/login", { email, password });
      gaEvent(GA_EVENTS.login, { method: "password" });
      // router.push 는 remount 가 없어 AuthSync(마운트 1회)가 다시 돌지 않는다 —
      // 로그인 직후 store 동기화(+익명 세션 이관)를 직접 수행해야 사이드바가 즉시 반영.
      await syncAuthFromServer();
      afterLogin();
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
      gaEvent(GA_EVENTS.login, { method: "guest" });
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
            src="/logo.svg"
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

          <div className="grid grid-cols-3 gap-2">
            <a
              href={`/api/auth/login/google${ssoQuery}`}
              onClick={() => markOAuthLoginPending("google")}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong bg-surface text-sm font-medium text-fg transition hover:bg-surface-2"
            >
              Google
            </a>
            <a
              href={`/api/auth/login/github${ssoQuery}`}
              onClick={() => markOAuthLoginPending("github")}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong bg-surface text-sm font-medium text-fg transition hover:bg-surface-2"
            >
              GitHub
            </a>
            <a
              href={`/api/auth/login/kakao${ssoQuery}`}
              onClick={() => markOAuthLoginPending("kakao")}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong bg-[#FEE500] text-sm font-medium text-[#191600] transition hover:brightness-95"
            >
              Kakao
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

        {/* 자매 서비스 링크 — 비로그인 사용자의 유일한 진입점 (로그인 후엔 사이드바 계정 메뉴) */}
        <p className="mt-5 text-center text-xs text-faint">
          <a href={EXTERNAL_LINKS.homepage} target="_blank" rel="noopener noreferrer" className="transition hover:text-fg">
            {t("homepage")}
          </a>
          <span className="mx-2">·</span>
          <a href={EXTERNAL_LINKS.bench} target="_blank" rel="noopener noreferrer" className="transition hover:text-fg">
            {t("bench")}
          </a>
        </p>
      </div>
    </div>
  );
}
