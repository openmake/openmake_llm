"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Copy, Download, Loader2, RotateCw } from "lucide-react";
import type { ApiSuccess, DesktopLatestPayload, DesktopReleaseBlock } from "@openmake/shared-types";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ApiClient, ApiError } from "@/lib/api-client";
import { COPY_FEEDBACK_RESET_MS } from "@/lib/constants/ui-limits";

/** 화면의 OS 줄 키(라벨·설치 안내 키와 같다). 응답에 있는 블록만 그린다(최상위 값은 native 의 복제라 읽지 않는다). */
const OS_KEYS = ["native", "windows"] as const;
type OsKey = (typeof OS_KEYS)[number];

/**
 * PURE: OS 줄 하나가 그릴 서버 블록. macOS 줄은 새 정체성 `macos` 가 있으면 그것을, 없으면 `native` 를 그린다 —
 * `macos` 가 있을 때의 `native` 는 옛 앱 업데이터만 받는 다리 파일이라 화면에 내지 않는다.
 */
function releaseBlockFor(data: DesktopLatestPayload, key: OsKey): DesktopReleaseBlock | undefined {
  return key === "native" ? (data.macos ?? data.native) : data[key];
}

/**
 * 데스크톱 앱 설치 파일 목록·설치 안내 — GET /api/desktop/latest (공개 라우트). macOS 줄은 `macos ?? native` 하나.
 * 받기 주소·버전·해시는 서버 값 그대로 쓴다(주소 조립·버전 비교·OS 추정 없음). 게시본 없음은 서버의 404 로 판별한다.
 */
export function DesktopAppDownloads() {
  const t = useTranslations("desktopApp");
  const [copied, setCopied] = useState<OsKey | null>(null);
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["desktop-app", "latest"],
    queryFn: () => ApiClient.get<ApiSuccess<DesktopLatestPayload>>("/api/desktop/latest").then((r) => r.data),
    retry: false,
  });

  const copy = async (text: string, key: OsKey) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), COPY_FEEDBACK_RESET_MS);
    } catch {
      /* clipboard 미허용 환경 — 무시 */
    }
  };

  if (isPending) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  // 404 는 서버가 "게시본 없음"이라 판정한 것 — 항상 빈 상태. 그 밖의 오류는 보던 목록이 없을 때만 오류 화면(재조회 실패로 목록을 지우지 않는다).
  if (error instanceof ApiError && error.status === 404) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted">{t("notPublished")}</CardContent></Card>;
  }
  if (error && !data) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{t("loadFailed")}</span>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RotateCw className="h-3.5 w-3.5" />
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const blocks = OS_KEYS.flatMap((key) => {
    const block = releaseBlockFor(data, key);
    return block ? [{ key, block }] : [];
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("filesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          <ul className="divide-y divide-border">
            {blocks.map(({ key, block }) => (
              <li key={key} className="space-y-1.5 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-medium text-fg">{t(`os.${key}`)}</p>
                  <span className="text-xs text-muted">{t("version", { version: block.version })}</span>
                  <a
                    href={block.url}
                    download
                    className="ml-auto inline-flex h-8 items-center justify-center gap-2 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg shadow-2 transition hover:bg-accent-hover active:bg-accent-press"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t("download")}
                  </a>
                </div>
                <p className="break-all font-mono text-xs text-fg-2">{block.file}</p>
                {block.sha256 && (
                  <div className="flex items-start gap-2 text-xs">
                    <span className="shrink-0 text-muted">{t("sha256")}</span>
                    <code className="min-w-0 flex-1 break-all font-mono text-fg-2">{block.sha256}</code>
                    <button
                      type="button"
                      onClick={() => copy(block.sha256!, key)}
                      aria-label={t("copyFor", { os: t(`os.${key}`) })}
                      title={t("copyFor", { os: t(`os.${key}`) })}
                      className="shrink-0 text-muted hover:text-fg"
                    >
                      {copied === key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("install.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-2 pl-5 text-sm text-fg-2">
            {blocks.map(({ key }) => <li key={key}>{t(`install.${key}`)}</li>)}
            <li>
              {t.rich("install.apiKey", {
                link: (chunks) => <Link href="/api-access" className="text-accent underline">{chunks}</Link>,
              })}
            </li>
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
