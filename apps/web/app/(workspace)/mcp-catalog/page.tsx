"use client";

import { useEffect, useMemo, useState } from "react";
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

interface CatalogEntry {
  id: string;
  name: string;
  provider: string;
  description: string;
  toolCount: number;
  kind: CatalogKind;
  installed?: boolean;
}

/* ── 백엔드 응답 타입 (GET /api/mcp/catalog) ──────────────── */
interface ApiCatalogTemplate {
  id: string;
  display_name: string;
  description?: string;
  transport_type: "stdio" | "sse" | "streamable-http";
  is_enabled?: boolean;
}

function mapTemplate(t: ApiCatalogTemplate): CatalogEntry {
  return {
    id: t.id,
    name: t.display_name,
    // 카탈로그 템플릿은 provider/도구수/skill 구분 필드를 제공하지 않음.
    // provider 는 transport_type, 종류는 항상 server 로 표기.
    provider: t.transport_type,
    description: t.description || "설명이 없습니다.",
    toolCount: 0,
    kind: "server",
  };
}

/* ── 목업 데이터 — TODO: API 연동 (GET /api/mcp/catalog) ──── */
const MOCK_CATALOG: CatalogEntry[] = [
  {
    id: "mcp-filesystem",
    name: "Filesystem",
    provider: "Anthropic",
    description: "로컬 파일을 안전하게 읽고 쓰는 샌드박스 파일시스템 도구 모음.",
    toolCount: 8,
    kind: "server",
    installed: true,
  },
  {
    id: "mcp-github",
    name: "GitHub",
    provider: "GitHub",
    description: "이슈, PR, 리포지토리, 코드 검색을 다루는 GitHub 연동 서버.",
    toolCount: 21,
    kind: "server",
  },
  {
    id: "mcp-postgres",
    name: "PostgreSQL",
    provider: "Community",
    description: "읽기 전용 SQL 쿼리와 스키마 인트로스펙션을 제공하는 DB 도구.",
    toolCount: 5,
    kind: "server",
  },
  {
    id: "mcp-slack",
    name: "Slack",
    provider: "Slack",
    description: "채널 읽기, 메시지 전송, 사용자 검색 등 Slack 워크스페이스 연동.",
    toolCount: 11,
    kind: "server",
  },
  {
    id: "skill-pdf-extract",
    name: "PDF 추출 스킬",
    provider: "OpenMake",
    description: "PDF 문서에서 텍스트·표·메타데이터를 구조화해 추출하는 스킬.",
    toolCount: 3,
    kind: "skill",
  },
  {
    id: "skill-web-research",
    name: "웹 리서치 스킬",
    provider: "OpenMake",
    description: "다중 소스 검색·인용 검증·요약을 수행하는 딥 리서치 스킬.",
    toolCount: 4,
    kind: "skill",
  },
];

export default function McpCatalogPage() {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<CatalogEntry[]>(MOCK_CATALOG);
  const [loading, setLoading] = useState(true);
  // 실데이터는 toolCount 를 제공하지 않으므로 도구 수 배지를 숨긴다.
  const [showToolCount, setShowToolCount] = useState(true);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installError, setInstallError] = useState<Record<string, string>>({});

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

  async function handleInstall(e: CatalogEntry) {
    setInstalling((prev) => ({ ...prev, [e.id]: true }));
    setInstallError((prev) => ({ ...prev, [e.id]: "" }));
    try {
      // 카탈로그 설치 전용 라우트 — 백엔드가 template_id 로 command/args/env 를 채운다.
      // (일반 POST /servers 는 stdio 시 command 필수라 400 — from-catalog 가 정답)
      await ApiClient.post("/api/mcp/servers/from-catalog", {
        template_id: e.id,
        name: e.id.replace(/[^a-zA-Z0-9_-]/g, "-"), // name 은 영숫자/_/- 만 허용
      });
      setEntries((prev) =>
        prev.map((item) =>
          item.id === e.id ? { ...item, installed: true } : item,
        ),
      );
    } catch {
      setInstallError((prev) => ({
        ...prev,
        [e.id]: "설치 실패. 다시 시도해 주세요.",
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
        title="MCP 카탈로그"
        description="설치 가능한 MCP 서버와 스킬을 둘러보고 워크스페이스에 추가하세요."
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="relative mb-5 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름, 제공자, 설명으로 검색…"
            className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>

        {loading ? (
          <Card className="p-12 text-center text-muted">로딩 중…</Card>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center text-muted">
            검색 결과가 없습니다.
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
                      {e.kind === "skill" ? "스킬" : "서버"}
                    </Badge>
                  </div>

                  <p className="flex-1 text-sm leading-relaxed text-fg-2">
                    {e.description}
                  </p>

                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <div className="flex items-center justify-between">
                      {showToolCount ? (
                        <Badge tone="neutral">도구 {e.toolCount}개</Badge>
                      ) : (
                        <Badge tone="neutral">
                          <span className="font-mono">{e.provider}</span>
                        </Badge>
                      )}
                      {e.installed ? (
                        <Button variant="outline" size="sm" disabled>
                          설치됨
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={installing[e.id]}
                          onClick={() => handleInstall(e)}
                        >
                          {installing[e.id] ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                          설치
                        </Button>
                      )}
                    </div>
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
