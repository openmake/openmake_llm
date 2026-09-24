"use client";

/**
 * /admin/cost-rates — 비용 단가표 (F25 PR-1, 134). kind × rate_key × unit 당 USD micros.
 * 토큰류 unit 은 "1M 토큰당 USD" 로 입력한다(1 USD/1M = 1 micro/token 이라 값이 같다).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Coins, Plus, Trash2 } from "lucide-react";
import { PageHeader, PageBody, Card, CardHeader, CardTitle, CardContent, Button, Table, Th, Td } from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

interface Rate { kind: string; rate_key: string; unit: string; usd_micros_per_unit: string | number; note: string | null; updated_at: string }
interface KindDef { kind: string; units: string[] }
type Payload = ApiSuccess<{ rates: Rate[]; kinds: KindDef[] }>;

const inputCls = "h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";
const selectCls = "h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";

export default function AdminCostRatesPage() {
  const t = useTranslations("adminCostRates");
  const [rates, setRates] = useState<Rate[]>([]);
  const [kinds, setKinds] = useState<KindDef[]>([]);
  const [kind, setKind] = useState("llm.local");
  const [rateKey, setRateKey] = useState("*");
  const [unit, setUnit] = useState("token_in");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await ApiClient.get<Payload>("/api/admin/cost-rates");
      setRates(r?.data?.rates ?? []); setKinds(r?.data?.kinds ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : t("loadError")); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const units = kinds.find((k) => k.kind === kind)?.units ?? [];
  useEffect(() => { if (units.length > 0 && !units.includes(unit)) setUnit(units[0]); }, [units, unit]);

  async function save() {
    setError(null);
    try {
      await ApiClient.put("/api/admin/cost-rates", { kind, rateKey, unit, usdMicrosPerUnit: Number(value), note: note || null });
      setValue(""); setNote(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : t("saveFailed")); }
  }
  async function remove(r: Rate) {
    if (!confirm(t("deleteConfirm"))) return;
    await ApiClient.del(`/api/admin/cost-rates/${encodeURIComponent(r.kind)}/${encodeURIComponent(r.rate_key)}/${encodeURIComponent(r.unit)}`);
    await load();
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <AdminTabs />
      <PageBody>
        <div className="space-y-6">
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Coins className="h-4 w-4" /> {t("addTitle")}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-5">
                <select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="kind">
                  {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.kind}</option>)}
                </select>
                <input className={inputCls} value={rateKey} onChange={(e) => setRateKey(e.target.value)} placeholder={t("rateKeyPlaceholder")} aria-label="rate_key" />
                <select className={selectCls} value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="unit">
                  {units.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <input className={inputCls} type="number" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("valuePlaceholder")} aria-label="value" />
                <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} aria-label="note" />
              </div>
              <p className="text-[11px] text-muted">{t("unitHelp")}</p>
              <Button size="sm" disabled={!rateKey.trim() || value === ""} onClick={() => void save()}><Plus className="h-3.5 w-3.5" /> {t("save")}</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("listTitle")}</CardTitle></CardHeader>
            <CardContent>
              {rates.length === 0 ? <p className="text-xs text-muted">{t("empty")}</p> : (
                <Table>
                  <thead><tr><Th>kind</Th><Th>rate_key</Th><Th>unit</Th><Th>{t("value")}</Th><Th>{t("note")}</Th><Th></Th></tr></thead>
                  <tbody>
                    {rates.map((r) => (
                      <tr key={`${r.kind}|${r.rate_key}|${r.unit}`}>
                        <Td>{r.kind}</Td><Td className="font-mono text-xs">{r.rate_key}</Td><Td>{r.unit}</Td>
                        <Td>{Number(r.usd_micros_per_unit).toLocaleString()}</Td><Td className="text-xs text-muted">{r.note ?? ""}</Td>
                        <Td><Button size="sm" variant="ghost" aria-label={t("delete")} onClick={() => void remove(r)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
