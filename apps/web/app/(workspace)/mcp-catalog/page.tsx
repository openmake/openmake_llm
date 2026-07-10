"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, Boxes, Download, Loader2 } from "lucide-react";
import {
  Button,
  Badge,
  PageHeader,
  Card,
  CardContent,
} from "@/components/ui/primitives";
import type { ApiSuccess as ApiEnvelope } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/* ── 타입 ────────────────────────────────────────────────── */
type CatalogKind = "server" | "skill";

/** 설치 시 입력받아야 하는 필수 자격증명(env) 필드. env_schema 에서 파생. */
interface EnvField {
  key: string;
  title: string;
  description?: string;
  secret: boolean;
}

interface CatalogEntry {
  id: string;
  name: string;
  provider: string;
  description: string;
  toolCount: number;
  kind: CatalogKind;
  installed?: boolean;
  /** 설치 전 입력이 필요한 필수 env 필드 (없으면 즉시 설치). */
  envFields: EnvField[];
}

/* ── 백엔드 응답 타입 (GET /api/mcp/catalog) ──────────────── */
interface ApiEnvSchema {
  required?: string[];
  properties?: Record<
    string,
    { title?: string; description?: string; secret?: boolean }
  >;
}

interface ApiCatalogTemplate {
  id: string;
  display_name: string;
  description?: string;
  transport_type: "stdio" | "sse" | "streamable-http";
  is_enabled?: boolean;
  env_schema?: ApiEnvSchema;
}

function mapTemplate(t: ApiCatalogTemplate): CatalogEntry {
  // env_schema.required 로 지정된 secret/일반 필드를 설치 폼 입력으로 노출한다.
  const props = t.env_schema?.properties ?? {};
  const envFields: EnvField[] = (t.env_schema?.required ?? []).map((key) => ({
    key,
    title: props[key]?.title || key,
    description: props[key]?.description,
    secret: props[key]?.secret === true,
  }));
  return {
    id: t.id,
    name: t.display_name,
    // 카탈로그 템플릿은 provider/도구수/skill 구분 필드를 제공하지 않음.
    // provider 는 transport_type, 종류는 항상 server 로 표기.
    provider: t.transport_type,
    description: t.description || "",
    toolCount: 0,
    kind: "server",
    envFields,
  };
}

/* ── 목업 데이터 — TODO: API 연동 (GET /api/mcp/catalog) ──── */
function buildMockCatalog(t: (key: string) => string): CatalogEntry[] {
  const mock: Omit<CatalogEntry, "envFields">[] = [
    {
      id: "mcp-filesystem",
      name: "Filesystem",
      provider: "Anthropic",
      description: t("mock.filesystem"),
      toolCount: 8,
      kind: "server",
      installed: true,
    },
    {
      id: "mcp-github",
      name: "GitHub",
      provider: "GitHub",
      description: t("mock.github"),
      toolCount: 21,
      kind: "server",
    },
    {
      id: "mcp-postgres",
      name: "PostgreSQL",
      provider: "Community",
      description: t("mock.postgres"),
      toolCount: 5,
      kind: "server",
    },
    {
      id: "mcp-slack",
      name: "Slack",
      provider: "Slack",
      description: t("mock.slack"),
      toolCount: 11,
      kind: "server",
    },
    {
      id: "skill-pdf-extract",
      name: t("mock.pdfExtractName"),
      provider: "OpenMake",
      description: t("mock.pdfExtract"),
      toolCount: 3,
      kind: "skill",
    },
    {
      id: "skill-web-research",
      name: t("mock.webResearchName"),
      provider: "OpenMake",
      description: t("mock.webResearch"),
      toolCount: 4,
      kind: "skill",
    },
  ];
  return mock.map((e) => ({ ...e, envFields: [] as EnvField[] }));
}

export default function McpCatalogPage() {
  const t = useTranslations("mcpCatalog");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<CatalogEntry[]>(() =>
    buildMockCatalog(t),
  );
  const [loading, setLoading] = useState(true);
  // 실데이터는 toolCount 를 제공하지 않으므로 도구 수 배지를 숨긴다.
  const [showToolCount, setShowToolCount] = useState(true);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installError, setInstallError] = useState<Record<string, string>>({});
  // 설치 전 자격증명(env) 입력이 필요한 항목의 인라인 폼 상태.
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [envDraft, setEnvDraft] = useState<Record<string, string>>({});

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
        setShowToolCount(false);
      } catch {
        // 401·실패 → 목업 유지 (데모)
        if (!cancelled) setShowToolCount(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 설치 시작: 필수 env 필드가 있으면 인라인 폼을 열고, 없으면 즉시 설치.
  function beginInstall(e: CatalogEntry) {
    setInstallError((prev) => ({ ...prev, [e.id]: "" }));
    if (e.envFields.length > 0) {
      setConfiguringId(e.id);
      setEnvDraft(Object.fromEntries(e.envFields.map((f) => [f.key, ""])));
      return;
    }
    void doInstall(e, {});
  }

  async function doInstall(e: CatalogEntry, env: Record<string, string>) {
    setInstalling((prev) => ({ ...prev, [e.id]: true }));
    setInstallError((prev) => ({ ...prev, [e.id]: "" }));
    try {
      // 카탈로그 설치 전용 라우트 — 백엔드가 template_id 로 command/args/env 를 채운다.
      // (일반 POST /servers 는 stdio 시 command 필수라 400 — from-catalog 가 정답)
      // env 의 secret 필드는 백엔드 createFromCatalog 가 AES-256-GCM 으로 암호화 저장.
      await ApiClient.post("/api/mcp/servers/from-catalog", {
        template_id: e.id,
        name: e.id.replace(/[^a-zA-Z0-9_-]/g, "-"), // name 은 영숫자/_/- 만 허용
        ...(Object.keys(env).length > 0 ? { env } : {}),
      });
      setEntries((prev) =>
        prev.map((item) =>
          item.id === e.id ? { ...item, installed: true } : item,
        ),
      );
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
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
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
                      {showToolCount ? (
                        <Badge tone="neutral">
                          {t("toolCount", { count: e.toolCount })}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">
                          <span className="font-mono">{e.provider}</span>
                        </Badge>
                      )}
                      {e.installed ? (
                        <Button variant="outline" size="sm" disabled>
                          {t("installed")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={installing[e.id]}
                          onClick={() => beginInstall(e)}
                        >
                          {installing[e.id] ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                          {t("install")}
                        </Button>
                      )}
                    </div>

                    {/* 필수 자격증명 입력 폼 — env_schema.required 가 있는 서버(Notion·GitHub 등) */}
                    {configuringId === e.id && (
                      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
                        <p className="text-xs font-medium text-fg">
                          {t("credentialsTitle")}
                        </p>
                        {e.envFields.map((f) => (
                          <label key={f.key} className="flex flex-col gap-1">
                            <span className="text-xs text-fg-2">{f.title}</span>
                            <input
                              type={f.secret ? "password" : "text"}
                              autoComplete="off"
                              value={envDraft[f.key] ?? ""}
                              onChange={(ev) =>
                                setEnvDraft((prev) => ({
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
                              e.envFields.some((f) => !envDraft[f.key]?.trim())
                            }
                            onClick={() => doInstall(e, envDraft)}
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
      </div>
    </>
  );
}
