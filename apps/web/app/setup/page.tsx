"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, LoaderCircle, CheckCircle2 } from "lucide-react";
import Image from "next/image";
import { ApiClient, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";

interface SetupStatus {
  setupNeeded: boolean;
  defaults?: { llmBaseUrl: string };
}

const inputCls =
  "mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-[var(--accent-ring)]";

/**
 * 첫 실행 셋업 마법사 — admin 0명일 때만 유효한 일회성 페이지.
 * 관리자 계정 생성 + LLM 게이트웨이(선택) 설정. 완료/불필요 시 /login 으로 이동.
 */
export default function SetupPage() {
  const t = useTranslations("setup");
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await ApiClient.get<ApiSuccess<SetupStatus>>("/api/setup/status");
        if (!r?.data?.setupNeeded) {
          router.replace("/login");
          return;
        }
        setLlmBaseUrl(r.data.defaults?.llmBaseUrl ?? "");
      } catch {
        /* status 확인 실패 시 폼은 남겨두고 제출 시 서버가 판정 */
      } finally {
        setChecking(false);
      }
    })();
  }, [router]);

  const submit = async () => {
    if (password !== passwordConfirm) {
      setError(t("passwordMismatch"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await ApiClient.post("/api/setup", {
        adminEmail: email,
        adminPassword: password,
        ...(llmBaseUrl.trim() ? { llmBaseUrl: llmBaseUrl.trim() } : {}),
        ...(llmApiKey.trim() ? { llmApiKey: llmApiKey.trim() } : {}),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("failed"));
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="grid min-h-dvh place-items-center bg-app">
        <LoaderCircle className="h-6 w-6 animate-spin text-muted" aria-hidden />
      </div>
    );
  }

  if (done) {
    return (
      <div className="grid min-h-dvh place-items-center bg-app px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 text-center shadow-2">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden />
          <h1 className="mt-3 text-xl font-bold text-fg">{t("doneTitle")}</h1>
          <p className="mt-1 text-sm text-muted">{t("doneDesc")}</p>
          <Button className="mt-5 w-full" onClick={() => router.push("/login")}>
            {t("goLogin")} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-app px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <Image src="/logo.svg" alt="OpenMake" width={48} height={48}
            className="h-12 w-12 rounded-xl object-contain" priority />
          <h1 className="mt-4 text-2xl font-bold text-fg">{t("title")}</h1>
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
            <div className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
              {error}
            </div>
          )}

          <h2 className="text-sm font-semibold text-fg">{t("adminSection")}</h2>

          <label className="mt-3 block text-xs font-medium text-fg-2">{t("emailLabel")}</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com" className={inputCls} />

          <label className="mt-4 block text-xs font-medium text-fg-2">{t("passwordLabel")}</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••" autoComplete="new-password" className={inputCls} />
          <p className="mt-1 text-[11px] text-faint">{t("passwordHint")}</p>

          <label className="mt-3 block text-xs font-medium text-fg-2">{t("passwordConfirmLabel")}</label>
          <input type="password" required value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            placeholder="••••••••" autoComplete="new-password" className={inputCls} />

          <div className="my-5 h-px bg-border" />

          <h2 className="text-sm font-semibold text-fg">{t("llmSection")}</h2>
          <p className="mt-1 text-[11px] text-faint">{t("llmOptionalHint")}</p>

          <label className="mt-3 block text-xs font-medium text-fg-2">{t("llmBaseUrlLabel")}</label>
          <input type="url" value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)}
            placeholder="http://127.0.0.1:13401" className={inputCls} />

          <label className="mt-4 block text-xs font-medium text-fg-2">{t("llmApiKeyLabel")}</label>
          <input type="password" value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)}
            placeholder="sk-..." autoComplete="off" className={inputCls} />

          <Button type="submit" disabled={loading} className="mt-6 w-full">
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {t("submit")} <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
