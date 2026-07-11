"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  KeyRound,
  Plus,
  Trash2,
  Loader2,
  Copy,
  Check,
  RotateCw,
  AlertTriangle,
  Power,
} from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  PageHeader,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient, ApiError } from "@/lib/api-client";
import { DeveloperTabs } from "@/components/hub-tabs";

/* ── 타입 (백엔드 /api/api-keys 응답) ──────────────── */
interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  last_4: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  total_requests: number;
}

interface CreatedKey {
  key: string;
  quick_start?: { curl: string; models_url: string; docs_url: string };
}

function formatDate(iso: string | null | undefined, locale: string) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function ApiAccessPage() {
  const t = useTranslations("apiAccess");
  const locale = useLocale();

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 발급/순환 직후 평문 키 1회 노출 (재조회 불가)
  const [revealed, setRevealed] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ApiClient.get<ApiSuccess<{ api_keys: ApiKeyRow[] }>>("/api/api-keys");
      setKeys(res?.data?.api_keys ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await ApiClient.post<ApiSuccess<CreatedKey>>("/api/api-keys", {
        name: newName.trim(),
      });
      setRevealed(res.data);
      setNewName("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (k: ApiKeyRow) => {
    setBusyId(k.id);
    setError(null);
    try {
      await ApiClient.patch(`/api/api-keys/${k.id}`, { is_active: !k.is_active });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("updateFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const rotate = async (k: ApiKeyRow) => {
    if (!window.confirm(t("rotateConfirm", { name: k.name }))) return;
    setBusyId(k.id);
    setError(null);
    try {
      const res = await ApiClient.post<ApiSuccess<CreatedKey>>(`/api/api-keys/${k.id}/rotate`);
      setRevealed(res.data);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("rotateFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (k: ApiKeyRow) => {
    if (!window.confirm(t("deleteConfirm", { name: k.name }))) return;
    setBusyId(k.id);
    setError(null);
    try {
      await ApiClient.del(`/api/api-keys/${k.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("deleteFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500);
    } catch {
      /* clipboard 미허용 환경 — 무시 */
    }
  };

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <DeveloperTabs />

      <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
        {error && (
          <div className="flex items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* 발급/순환 직후 평문 키 1회 노출 배너 */}
        {revealed && (
          <Card className="border-warn">
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-warn">
                <AlertTriangle className="h-4 w-4" />
                {t("reveal.title")}
              </CardTitle>
              <button
                onClick={() => setRevealed(null)}
                className="text-xs text-muted hover:text-fg"
              >
                {t("reveal.dismiss")}
              </button>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted">{t("reveal.warning")}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-fg">
                  {revealed.key}
                </code>
                <Button size="sm" variant="outline" onClick={() => copy(revealed.key, "key")}>
                  {copied === "key" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied === "key" ? t("reveal.copied") : t("reveal.copyKey")}
                </Button>
              </div>
              {revealed.quick_start && (
                <div>
                  <p className="mb-1 text-xs font-medium text-fg-2">{t("reveal.curlTitle")}</p>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-2">
                      {revealed.quick_start.curl}
                    </pre>
                    <button
                      onClick={() => copy(revealed.quick_start!.curl, "curl")}
                      className="absolute right-2 top-2 rounded bg-surface px-1.5 py-1 text-muted hover:text-fg"
                      aria-label={t("reveal.copyCurl")}
                    >
                      {copied === "curl" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 새 키 발급 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-accent" />
              {t("createTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
              className="flex items-center gap-2"
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                placeholder={t("namePlaceholder")}
                className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-[var(--accent-ring)]"
              />
              <Button type="submit" disabled={!newName.trim() || creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {t("createButton")}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* 키 목록 */}
        <Card>
          <CardHeader>
            <CardTitle>{t("listTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 py-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("loading")}
              </div>
            ) : keys.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted">{t("empty")}</div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("col.name")}</Th>
                    <Th>{t("col.key")}</Th>
                    <Th>{t("col.status")}</Th>
                    <Th>{t("col.created")}</Th>
                    <Th>{t("col.lastUsed")}</Th>
                    <Th className="text-right">{t("col.requests")}</Th>
                    <Th className="text-right">{t("col.actions")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <Td className="font-medium text-fg">{k.name}</Td>
                      <Td className="font-mono text-xs">
                        {k.key_prefix}
                        {"•".repeat(8)}
                        {k.last_4}
                      </Td>
                      <Td>
                        {k.is_active ? (
                          <Badge tone="success">{t("status.active")}</Badge>
                        ) : (
                          <Badge tone="neutral">{t("status.inactive")}</Badge>
                        )}
                      </Td>
                      <Td>{formatDate(k.created_at, locale)}</Td>
                      <Td>{k.last_used_at ? formatDate(k.last_used_at, locale) : t("neverUsed")}</Td>
                      <Td className="text-right tabular-nums">{k.total_requests}</Td>
                      <Td className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => toggle(k)}
                            disabled={busyId === k.id}
                            title={k.is_active ? t("action.deactivate") : t("action.activate")}
                            className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                          >
                            <Power className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => rotate(k)}
                            disabled={busyId === k.id}
                            title={t("action.rotate")}
                            className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                          >
                            <RotateCw className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => remove(k)}
                            disabled={busyId === k.id}
                            title={t("action.delete")}
                            className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
