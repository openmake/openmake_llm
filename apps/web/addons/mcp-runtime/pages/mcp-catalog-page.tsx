"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, Boxes, Download, Loader2, Server } from "lucide-react";
import {
  Button,
  Badge,
  PageHeader,
  PageBody,
  Card,
  CardContent,
} from "@/components/ui/primitives";
import type { ApiSuccess as ApiEnvelope } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

import {
  buildInstallPayload,
  hasMissingRequired,
  mapTemplate,
  type ApiCatalogTemplate,
  type CatalogEntry,
  type InstallField,
} from "./mcp-catalog-fields";

export function McpCatalogPage() {
  const t = useTranslations("mcpCatalog");
  const tTabs = useTranslations("pageTabs");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installError, setInstallError] = useState<Record<string, string>>({});
  // 설치 전 자격증명(env) 입력이 필요한 항목의 인라인 폼 상태.
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [envDraft, setEnvDraft] = useState<Record<string, string>>({});
  // 서버 실행 인자(args_schema) 입력 — env 와 키가 겹칠 수 있어 따로 둔다.
  const [argDraft, setArgDraft] = useState<Record<string, string>>({});
  // 설치 이름 — 같은 템플릿을 여러 접속처에 설치할 수 있으므로 인스턴스마다 이름을 받는다.
  const [nameDraft, setNameDraft] = useState("");
  // 이미 설치된 인스턴스 이름 — 기본 이름 제안 시 충돌 회피에 쓴다.
  const [installedNames, setInstalledNames] = useState<string[]>([]);

  const loadInstalled = useCallback(async () => {
    try {
      const r = await ApiClient.get<ApiEnvelope<{ servers: { name: string }[] }>>("/api/mcp/servers");
      setInstalledNames((r?.data?.servers ?? []).map((x) => x.name));
    } catch { /* 401·미배포: 제안 이름만 단순해진다 */ }
  }, []);
  useEffect(() => { void loadInstalled(); }, [loadInstalled]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ApiClient.get<
          ApiEnvelope<{ templates: ApiCatalogTemplate[] }>
        >("/api/mcp/catalog");
        if (cancelled) return;
        const list = res?.data?.templates ?? [];
        setEntries(list.map(mapTemplate));
      } catch {
        // 401·실패 → 빈 목록 (그전엔 목업 카탈로그가 실렌더됐다)
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 이미 쓰고 있는 이름을 피해 기본 이름을 제안한다 — 같은 템플릿을 두 번째로 설치할 때
   * `mcp-postgres-2` 처럼. 이름은 (user_id, name) 유니크라 충돌하면 서버가 409 를 낸다.
   */
  function suggestName(e: CatalogEntry): string {
    const base = e.id.replace(/[^a-zA-Z0-9_-]/g, "-");
    const used = new Set(installedNames);
    if (!used.has(base)) return base;
    for (let i = 2; i < 100; i += 1) {
      if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
    }
    return base;
  }

  // 설치 시작: 이름(필수) + 자격증명(있으면)을 받는 인라인 폼을 연다.
  // 종전에는 env 가 없으면 곧장 설치하면서 이름을 템플릿 id 로 고정해, 같은 템플릿을
  // 두 번 설치할 수 없었다(두 번째가 유니크 제약에 걸림).
  function beginInstall(e: CatalogEntry) {
    setInstallError((prev) => ({ ...prev, [e.id]: "" }));
    setConfiguringId(e.id);
    setNameDraft(suggestName(e));
    setEnvDraft(Object.fromEntries(e.envFields.map((f) => [f.key, ""])));
    setArgDraft(Object.fromEntries(e.argFields.map((f) => [f.key, ""])));
  }

  async function doInstall(
    e: CatalogEntry,
    args: Record<string, string>,
    env: Record<string, string>,
    name: string,
  ) {
    setInstalling((prev) => ({ ...prev, [e.id]: true }));
    setInstallError((prev) => ({ ...prev, [e.id]: "" }));
    try {
      // 카탈로그 설치 전용 라우트 — 백엔드가 template_id 로 command/args/env 를 채운다.
      // (일반 POST /servers 는 stdio 시 command 필수라 400 — from-catalog 가 정답)
      // env 의 secret 필드는 백엔드 createFromCatalog 가 AES-256-GCM 으로 암호화 저장.
      // args(args_schema 필수 항목 — 예: Filesystem 의 root_path)도 함께 보낸다. 빠지면 서버가 400.
      // 빈 칸은 보내지 않고, args 는 스키마 type 으로 변환한다(buildInstallPayload).
      await ApiClient.post("/api/mcp/servers/from-catalog", buildInstallPayload(e, args, env, name));
      setEntries((prev) =>
        prev.map((item) =>
          item.id === e.id ? { ...item, installed: true } : item,
        ),
      );
      void loadInstalled(); // 다음 추가 설치의 기본 이름 제안이 새 이름을 피하도록
      setConfiguringId((cur) => (cur === e.id ? null : cur));
    } catch {
      setInstallError((prev) => ({
        ...prev,
        [e.id]: t("installError"),
      }));
    } finally {
      setInstalling((prev) => ({ ...prev, [e.id]: false }));
    }
  }

  // 필드 종류(arg/env)에 맞는 입력 상태
  const draftOf = (f: InstallField) => (f.kind === "arg" ? argDraft : envDraft);
  const setDraftOf = (f: InstallField) => (f.kind === "arg" ? setArgDraft : setEnvDraft);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.provider.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    );
  }, [entries, query]);

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
        actions={
          /* 커넥터 관리는 설정 '커넥터' 탭으로 이동 (2026-07-17 사이드바 2차 통폐합 — 구 McpTabs 대체) */
          <Button variant="outline" size="sm" onClick={() => router.push("/settings?tab=connectors")}>
            <Server className="h-4 w-4" />
            {tTabs("myServers")}
          </Button>
        }
      />

      <PageBody>
        <div className="relative mb-5 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </div>

        {loading ? (
          <Card className="p-12 text-center text-muted">{t("loading")}</Card>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center text-muted">
            {t("emptyState")}
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((e) => (
              <Card key={e.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2 text-accent">
                        <Boxes className="h-5 w-5" />
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-fg">
                          {e.name}
                        </h3>
                        <p className="text-xs text-faint">{e.provider}</p>
                      </div>
                    </div>
                    <Badge tone={e.kind === "skill" ? "accent" : "neutral"}>
                      {e.kind === "skill" ? t("kindSkill") : t("kindServer")}
                    </Badge>
                  </div>

                  <p className="flex-1 text-sm leading-relaxed text-fg-2">
                    {e.description || t("noDescription")}
                  </p>

                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <div className="flex items-center justify-between">
                      {/* 실데이터는 toolCount 를 제공하지 않는다 — 목업 전용이던 도구 수 배지는 제거 */}
                      <Badge tone="neutral">
                        <span className="font-mono">{e.provider}</span>
                      </Badge>
                      {/* 설치 여부와 무관하게 추가 설치를 허용한다 — 같은 템플릿을 서로 다른
                          접속처(예: 앱 DB용 / 분석 DB용 postgres)에 이름만 달리해 여러 개 둘 수 있다.
                          종전에는 설치되면 버튼이 잠겨 두 번째 인스턴스를 만들 수 없었다. */}
                      {e.installed && <Badge tone="success">{t("installed")}</Badge>}
                      <Button
                        size="sm"
                        variant={e.installed ? "outline" : "default"}
                        disabled={installing[e.id]}
                        onClick={() => beginInstall(e)}
                      >
                        {installing[e.id] ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        {e.installed ? t("installAnother") : t("install")}
                      </Button>
                    </div>

                    {/* 설치 입력 폼 — 실행 인자(args_schema, 예: Filesystem 루트 경로) 다음에 자격증명(env_schema, Notion·GitHub 등) */}
                    {configuringId === e.id && (
                      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
                        <p className="text-xs font-medium text-fg">
                          {e.envFields.length > 0 ? t("credentialsTitle") : t("installFormTitle")}
                        </p>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-fg-2">{t("nameLabel")}</span>
                          <input
                            value={nameDraft}
                            onChange={(ev) => setNameDraft(ev.target.value)}
                            pattern="[A-Za-z0-9_-]+"
                            placeholder="mcp-postgres-analytics"
                            className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-xs text-fg placeholder:text-muted focus:border-accent focus:outline-none"
                          />
                          <span className="text-[11px] text-muted">{t("nameHint")}</span>
                        </label>
                        {[...e.argFields, ...e.envFields].map((f) => (
                          <label key={`${f.kind}:${f.key}`} className="flex flex-col gap-1">
                            <span className="text-xs text-fg-2">
                              {f.title}
                              {!f.required && (
                                <span className="ml-1 text-[11px] text-muted">{t("optionalTag")}</span>
                              )}
                            </span>
                            <input
                              type={f.secret ? "password" : "text"}
                              autoComplete="off"
                              value={draftOf(f)[f.key] ?? ""}
                              onChange={(ev) =>
                                setDraftOf(f)((prev) => ({
                                  ...prev,
                                  [f.key]: ev.target.value,
                                }))
                              }
                              placeholder={f.description || f.key}
                              className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs text-fg placeholder:text-muted focus:border-accent focus:outline-none"
                            />
                          </label>
                        ))}
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfiguringId(null)}
                          >
                            {t("cancel")}
                          </Button>
                          <Button
                            size="sm"
                            disabled={
                              installing[e.id] ||
                              !/^[A-Za-z0-9_-]+$/.test(nameDraft) ||
                              hasMissingRequired(e.argFields, argDraft) ||
                              hasMissingRequired(e.envFields, envDraft)
                            }
                            onClick={() => doInstall(e, argDraft, envDraft, nameDraft)}
                          >
                            {installing[e.id] ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                            {t("install")}
                          </Button>
                        </div>
                      </div>
                    )}

                    {installError[e.id] && (
                      <p className="text-xs text-danger">{installError[e.id]}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
