"use client";

/**
 * 마켓플레이스 게시 (발행형) — 내가 만든 스킬·Custom Agent·MCP 설정을 플러그인 번들로 묶어
 * openmake 마켓플레이스 레포에 PR 로 올린다. 확장에서 설치된 것은 후보에서 빠진다(상류가 따로 있음).
 *
 * 게시는 admin 만 — 공개 레포에 쓰는 행위라서. 토큰은 서버 설정(MARKETPLACE_PUBLISH_TOKEN)이
 * 없을 때만 입력란이 뜬다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { UploadCloud, Loader2, ExternalLink } from "lucide-react";
import { Button, Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";
import type { ApiSuccess } from "@openmake/shared-types";
import { useAppStore } from "@/lib/store";

interface Candidates {
  skills: { id: string; name: string; description: string | null; category: string | null }[];
  agents: { id: string; name: string; description: string | null }[];
  mcpServers: { id: string; name: string; transport_type: string; env_keys: string[] }[];
  repo: { owner: string; repo: string };
}
interface PublishResult { prUrl: string; branch: string; files: string[]; bytes: number; missing: { skills: string[]; agents: string[]; mcpServers: string[] } }

export function MarketplacePublishSection() {
  const t = useTranslations("marketplacePublish");
  const isAdmin = useAppStore((s) => s.auth.currentUser?.role === "admin");
  const [cands, setCands] = useState<Candidates | null>(null);
  const [sel, setSel] = useState<{ skills: Set<string>; agents: Set<string>; mcp: Set<string> }>({ skills: new Set(), agents: new Set(), mcp: new Set() });
  const [pluginName, setPluginName] = useState("");
  const [description, setDescription] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await ApiClient.get<ApiSuccess<Candidates>>("/api/marketplace/publish/candidates");
      setCands(r.data);
    } catch { setCands({ skills: [], agents: [], mcpServers: [], repo: { owner: "", repo: "" } }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = (kind: "skills" | "agents" | "mcp", id: string) =>
    setSel((p) => { const n = new Set(p[kind]); n.has(id) ? n.delete(id) : n.add(id); return { ...p, [kind]: n }; });
  const total = sel.skills.size + sel.agents.size + sel.mcp.size;

  async function publish() {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await ApiClient.post<ApiSuccess<PublishResult>>("/api/marketplace/publish", {
        pluginName: pluginName.trim(), description: description.trim() || undefined,
        skillIds: [...sel.skills], agentIds: [...sel.agents], mcpServerIds: [...sel.mcp],
        ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
      });
      setResult(r.data);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (!cands) return null;
  const list = <T extends { id: string; name: string }>(kind: "skills" | "agents" | "mcp", items: T[], label: string, extra?: (x: T) => string) => (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">{label} ({items.length})</p>
      {items.length === 0 ? <p className="text-xs text-faint">{t("none")}</p> : (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {items.map((x) => (
            <li key={x.id}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={sel[kind].has(x.id)} onChange={() => toggle(kind, x.id)} />
                <span className="truncate">{x.name}</span>
                {extra && <span className="ml-auto text-xs text-faint">{extra(x)}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><UploadCloud className="h-4 w-4 text-accent" />{t("title")}</CardTitle>
        <p className="mt-0.5 text-xs text-muted">{t("description", { repo: `${cands.repo.owner}/${cands.repo.repo}` })}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={pluginName} onChange={(e) => setPluginName(e.target.value)} placeholder={t("namePlaceholder")}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descPlaceholder")}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {list("skills", cands.skills, t("skills"), (s) => s.category ?? "")}
          {list("agents", cands.agents, t("agents"))}
          {list("mcp", cands.mcpServers, t("mcp"), (m) => m.env_keys.length ? t("envPlaceholders", { n: m.env_keys.length }) : m.transport_type)}
        </div>
        <p className="text-xs text-muted">{t("secretNote")}</p>
        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder={t("tokenPlaceholder")}
              className="min-w-[16rem] rounded-md border border-border bg-surface px-3 py-2 text-xs text-fg outline-none focus:border-accent" />
            <Button size="sm" disabled={busy || total === 0 || !pluginName.trim()} onClick={() => void publish()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
              {t("publish", { n: total })}
            </Button>
          </div>
        ) : <Badge tone="neutral">{t("adminOnly")}</Badge>}
        {error && <p className="text-sm text-danger">{error}</p>}
        {result && (
          <div className="rounded-md border border-success/40 bg-success-soft p-3 text-sm">
            <a href={result.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              {t("prCreated")} <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <p className="mt-1 text-xs text-muted">{t("prDetail", { branch: result.branch, files: result.files.length })}</p>
            {(result.missing.skills.length + result.missing.agents.length + result.missing.mcpServers.length) > 0 && (
              <p className="mt-1 text-xs text-warn">{t("missing")}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
