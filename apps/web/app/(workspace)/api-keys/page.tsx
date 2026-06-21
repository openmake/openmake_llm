"use client";

import { useCallback, useEffect, useState } from "react";
import {
  KeyRound,
  Plus,
  Trash2,
  Loader2,
  X,
  Save,
  AlertTriangle,
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
import { ApiClient } from "@/lib/api-client";

/* ── 타입 (백엔드 /api/external-keys 응답) ──────────────── */
type SdkType = "anthropic" | "openai-compatible";

interface UserKey {
  display_name: string;
  key_prefix: string;
  base_url: string | null;
  last_validation_ok: boolean | null;
  last_used_at: string | null;
  created_at: string;
}

interface ProviderEntry {
  provider_id: string;
  display_name: string;
  sdk_type: SdkType;
  default_base_url: string | null;
  help_text?: string;
  user_key: UserKey | null;
}

const SDK_LABEL: Record<SdkType, string> = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI 호환",
};

function formatDate(iso?: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function ApiKeysPage() {
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ApiClient.get<ApiSuccess<{ providers: ProviderEntry[] }>>(
        "/api/external-keys",
      );
      setProviders(res?.data?.providers ?? []);
    } catch (e) {
      // TODO: API 연동 — 비로그인/오류 시 목업 카탈로그 노출
      setError(
        e instanceof Error ? e.message : "키 목록을 불러오지 못했습니다.",
      );
      setProviders([
        {
          provider_id: "anthropic",
          display_name: "Anthropic",
          sdk_type: "anthropic",
          default_base_url: "https://api.anthropic.com",
          user_key: {
            display_name: "프로덕션",
            key_prefix: "sk-ant-",
            base_url: null,
            last_validation_ok: true,
            last_used_at: "2026-06-18T08:21:00Z",
            created_at: "2026-05-30T02:10:00Z",
          },
        },
        {
          provider_id: "openrouter",
          display_name: "OpenRouter",
          sdk_type: "openai-compatible",
          default_base_url: "https://openrouter.ai/api/v1",
          user_key: null,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function handleDelete(providerId: string, displayName: string) {
    if (
      !window.confirm(
        `${displayName} 키를 삭제하시겠습니까?\n이 키를 사용하는 모델 호출이 중단됩니다.`,
      )
    )
      return;
    try {
      await ApiClient.del(`/api/external-keys/${providerId}`);
      await load();
    } catch (e) {
      window.alert(
        "삭제 실패: " + (e instanceof Error ? e.message : "서버 오류"),
      );
    }
  }

  const registered = providers.filter((p) => p.user_key);

  return (
    <>
      <PageHeader
        title="API 키"
        description="외부 LLM 공급자(Anthropic / OpenAI 호환) 키를 등록하고 관리합니다."
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? "닫기" : "새 키 추가"}
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {showForm && (
            <AddKeyForm
              providers={providers}
              onClose={() => setShowForm(false)}
              onSaved={async () => {
                setShowForm(false);
                await load();
              }}
            />
          )}

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>등록된 공급자 키</CardTitle>
              {error && (
                <span className="inline-flex items-center gap-1 text-xs text-warn">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  목업 데이터 표시 중
                </span>
              )}
            </CardHeader>
            <CardContent className="px-0 py-0">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  키 목록을 불러오는 중...
                </div>
              ) : registered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <KeyRound className="h-8 w-8 text-faint" />
                  <p className="text-sm font-medium text-fg">
                    등록된 외부 키가 없습니다
                  </p>
                  <p className="text-xs text-muted">
                    새 키를 추가하면 해당 공급자 모델을 사용할 수 있습니다.
                  </p>
                </div>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>공급자</Th>
                      <Th>이름</Th>
                      <Th>키</Th>
                      <Th>생성일</Th>
                      <Th>상태</Th>
                      <Th className="text-right">작업</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {registered.map((p) => {
                      const k = p.user_key!;
                      const ok = k.last_validation_ok;
                      return (
                        <tr key={p.provider_id}>
                          <Td className="text-fg">
                            <div className="font-medium">{p.display_name}</div>
                            <div className="text-xs text-faint">
                              {SDK_LABEL[p.sdk_type]}
                            </div>
                          </Td>
                          <Td>{k.display_name}</Td>
                          <Td className="font-mono text-xs">
                            {k.key_prefix}
                            {"•".repeat(12)}
                          </Td>
                          <Td>{formatDate(k.created_at)}</Td>
                          <Td>
                            {ok === false ? (
                              <Badge tone="danger">검증 실패</Badge>
                            ) : ok ? (
                              <Badge tone="success">활성</Badge>
                            ) : (
                              <Badge tone="neutral">미검증</Badge>
                            )}
                          </Td>
                          <Td className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="삭제"
                              onClick={() =>
                                handleDelete(p.provider_id, p.display_name)
                              }
                            >
                              <Trash2 className="h-4 w-4 text-danger" />
                            </Button>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ── 인라인 키 추가 폼 ──────────────────────────────────── */
function AddKeyForm({
  providers,
  onClose,
  onSaved,
}: {
  providers: ProviderEntry[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [providerId, setProviderId] = useState(
    providers[0]?.provider_id ?? "anthropic",
  );
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selected = providers.find((p) => p.provider_id === providerId);

  async function handleSubmit() {
    if (!displayName.trim() || apiKey.trim().length < 8) {
      setFormError("이름과 8자 이상의 API 키를 입력하세요.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await ApiClient.post(`/api/external-keys/${providerId}`, {
        sdk_type: selected?.sdk_type ?? "openai-compatible",
        display_name: displayName.trim(),
        api_key: apiKey.trim(),
        base_url: baseUrl.trim() || null,
      });
      await onSaved();
    } catch (err) {
      setFormError(
        "저장 실패: " + (err instanceof Error ? err.message : "서버 오류"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>새 키 추가</CardTitle>
        <Button variant="ghost" size="icon" aria-label="닫기" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-2">
                공급자
              </span>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
              >
                {providers.map((p) => (
                  <option key={p.provider_id} value={p.provider_id}>
                    {p.display_name} ({SDK_LABEL[p.sdk_type]})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-2">
                이름
              </span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="예: 프로덕션, 개발용"
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-2">
              API 키
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 font-mono text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-2">
              Base URL (선택)
            </span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={selected?.default_base_url ?? "https://..."}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 font-mono text-sm text-fg outline-none focus:border-accent"
            />
          </label>

          {formError && <p className="text-xs text-danger">{formError}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              저장
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
