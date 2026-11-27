"use client";

/**
 * 이름 설치 입력 (마켓플레이스 M5) — `플러그인@마켓플레이스` 를 등록 카탈로그에서 해석해 설치한다.
 * 설치 미리보기가 켜져 있으면(mode="preview", M1b) 같은 해석·입력으로 미리본 뒤 확인해야 설치하고, 꺼져 있으면 바로 설치한다.
 * 모르는 이름이면 서버가 돌려준 후보만 보여 준다(자동 치환 없음 — 사용자가 골라 다시 설치).
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AtSign, Loader2 } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { ApiClient, ApiError } from "@/lib/api-client";
import { ExtensionInstallPreviewDialog } from "@/components/settings/extension-install-preview-dialog";
import { namedInstallPreviewTarget, type InstallPreviewTarget } from "@/lib/extension-install-preview";

/** 서버 이름 규칙과 같은 형식 검사(제출 전 안내용 — 판정 권한은 서버) */
const NAMED_REF = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/;

type Status =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "done"; name: string }
  | { state: "failed"; message?: string; candidates: string[] };

/** 400 응답 error.details.candidates — 그대로 다시 넣을 수 있는 `플러그인@마켓플레이스` 만 */
function candidatesOf(e: unknown): string[] {
  if (!(e instanceof ApiError)) return [];
  const details = (e.body as { error?: { details?: { candidates?: unknown } } } | undefined)?.error?.details;
  const list = Array.isArray(details?.candidates) ? details.candidates : [];
  return list.filter((c): c is string => typeof c === "string" && NAMED_REF.test(c));
}

export function NamedInstallForm({ mode = "direct", onInstalled }: { mode?: "preview" | "direct"; onInstalled: () => void }) {
  const t = useTranslations("extensions.catalog.named");
  const [ref, setRef] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [previewTarget, setPreviewTarget] = useState<InstallPreviewTarget | null>(null);
  const trimmed = ref.trim();
  const valid = NAMED_REF.test(trimmed) && !trimmed.includes("..");

  /** 설치 버튼·Enter — 미리보기 모드면 대화상자에서 확인한 뒤 install, 아니면 바로 install */
  function submit(value: string) {
    const target = namedInstallPreviewTarget(mode, value);
    if (target) setPreviewTarget(target);
    else void install(value);
  }

  async function install(value: string) {
    setStatus({ state: "busy" });
    try {
      const res = await ApiClient.post<{ data?: { name?: string } }>("/api/users/me/extensions/install-by-name", { ref: value });
      setStatus({ state: "done", name: res?.data?.name ?? value });
      setRef("");
      onInstalled();
    } catch (e) {
      setStatus({ state: "failed", message: e instanceof ApiError ? e.message : undefined, candidates: candidatesOf(e) });
    }
  }

  return (
    <div className="mb-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <AtSign className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <Input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid && status.state !== "busy") submit(trimmed);
          }}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          className="min-w-0 flex-1 font-mono"
        />
        <Button size="sm" disabled={!valid || status.state === "busy"} onClick={() => submit(trimmed)}>
          {status.state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" /> : t("install")}
        </Button>
      </div>
      {trimmed && !valid && <p className="text-xs text-muted">{t("formatHint")}</p>}
      {status.state === "done" && <p className="text-xs text-success">{t("installed", { name: status.name })}</p>}
      {status.state === "failed" && (
        <div className="text-xs">
          <p className="text-danger">{status.message ?? t("failed")}</p>
          {status.candidates.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-muted">
              {t("candidates")}
              {status.candidates.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-fg-2 hover:bg-surface-2"
                  onClick={() => setRef(c)}
                >
                  {c}
                </button>
              ))}
            </p>
          )}
        </div>
      )}
      <ExtensionInstallPreviewDialog
        target={previewTarget}
        onClose={() => setPreviewTarget(null)}
        onConfirm={(tg) => { if (tg.kind === "named") void install(tg.ref); }}
      />
    </div>
  );
}
