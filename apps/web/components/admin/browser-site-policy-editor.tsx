"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { FlaskConical, Loader2, Plus, RotateCcw, Save, X } from "lucide-react";
import {
  BROWSER_SITE_POLICY_MAX_JSON_CHARS,
  browserHostMatches,
  browserHostOf,
  browserSitePolicyProblems,
  normalizeBrowserSitePattern,
  parseBrowserSitePolicy,
  type BrowserSitePolicy,
} from "@openmake/config";
import { Badge, Button, Input } from "@/components/ui/primitives";

/** 이 편집기가 맡는 시스템 설정 키 (서버 config/system-settings-registry) */
export const BROWSER_SITE_POLICY_SETTING_KEY = "BROWSER_SITE_POLICY";

type ListName = keyof BrowserSitePolicy;
const LISTS: ListName[] = ["allow", "deny"];

/** `javascript:`·`mailto:` 처럼 `//` 없는 스킴 — `example.com:443` 같은 포트는 제외 */
const BARE_SCHEME_RE = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/** 시험 입력 → 호스트. 스킴 없이 넣은 호스트는 https 로 본다. http(s) 가 아니면 null. */
function testHostOf(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (s.includes("://")) return browserHostOf(s);
  if (BARE_SCHEME_RE.test(s)) return null;
  return browserHostOf(`https://${s}`);
}

function serialize(p: BrowserSitePolicy): string {
  return JSON.stringify({ allow: p.allow, deny: p.deny });
}

/** 패턴 목록 하나 — 추가 입력 + 항목(삭제 단추) */
function PatternList({ name, patterns, disabled, onChange }: {
  name: ListName;
  patterns: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("adminSystemSettings.browserSitePolicy");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function add() {
    const r = normalizeBrowserSitePattern(input);
    setNotice(null);
    if (!r.ok) {
      setError(t(`errors.${r.error}`));
      return;
    }
    if (patterns.includes(r.pattern)) {
      setError(t("errors.duplicate", { pattern: r.pattern }));
      return;
    }
    setError(null);
    if (r.pattern !== input.trim()) setNotice(t("normalized", { input: input.trim(), pattern: r.pattern }));
    onChange([...patterns, r.pattern]);
    setInput("");
  }

  const inputId = `browser-site-${name}`;
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div>
        <label htmlFor={inputId} className="text-sm font-medium">{t(`${name}Title`)}</label>
        <p className="text-xs text-muted">{t(`${name}Help`)}</p>
      </div>
      <div className="flex gap-1">
        <Input
          id={inputId}
          value={input}
          autoComplete="off"
          placeholder={t("addPlaceholder")}
          disabled={disabled}
          aria-invalid={error !== null}
          onChange={(e) => { setInput(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <Button size="sm" variant="outline" className="h-9 whitespace-nowrap" disabled={disabled || !input.trim()} onClick={add}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("add")}
        </Button>
      </div>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      {notice && <p className="text-xs text-muted" role="status">{notice}</p>}
      {patterns.length === 0 ? (
        <p className="text-xs text-muted">{t("empty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {patterns.map((p) => {
            const r = normalizeBrowserSitePattern(p);
            const valid = r.ok && r.pattern === p;
            return (
              <li key={p} className="inline-flex items-center gap-1 rounded-md border bg-surface-2 py-0.5 pl-2 pr-0.5 text-xs">
                <code>{p}</code>
                {!valid && <Badge tone="danger" title={t("invalidEntry")}>{t("invalidBadge")}</Badge>}
                <Button variant="ghost" size="icon-sm" className="h-6 w-6" disabled={disabled}
                  aria-label={t("remove", { pattern: p })} title={t("remove", { pattern: p })}
                  onClick={() => onChange(patterns.filter((x) => x !== p))}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "이 주소는 어떻게 판정되나" — 편집 중인 목록으로 서버·기기와 같은 판정(@openmake/config)을 돌린다 */
function PolicyTester({ policy }: { policy: BrowserSitePolicy }) {
  const t = useTranslations("adminSystemSettings.browserSitePolicy");
  const [url, setUrl] = useState("");
  const host = testHostOf(url);
  const denyHit = host ? policy.deny.find((p) => browserHostMatches(host, p)) : undefined;
  const allowHit = host ? policy.allow.find((p) => browserHostMatches(host, p)) : undefined;

  let verdict: { tone: "success" | "warn" | "danger"; text: string } | null = null;
  if (url.trim()) {
    if (!host) verdict = { tone: "danger", text: t("testInvalidUrl") };
    else if (denyHit) verdict = { tone: "warn", text: t("verdictDenied", { host, pattern: denyHit }) };
    else if (allowHit) verdict = { tone: "success", text: t("verdictAllowed", { host, pattern: allowHit }) };
    else verdict = { tone: "warn", text: t("verdictOffList", { host }) };
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <label htmlFor="browser-site-test" className="flex items-center gap-1.5 text-sm font-medium">
        <FlaskConical className="h-4 w-4" aria-hidden />
        {t("testTitle")}
      </label>
      <p className="text-xs text-muted">{t("testHelp")}</p>
      <Input id="browser-site-test" value={url} autoComplete="off" placeholder={t("testPlaceholder")}
        onChange={(e) => setUrl(e.target.value)} />
      {verdict && (
        <p className="flex items-start gap-2 text-sm" role="status">
          <Badge tone={verdict.tone} className="shrink-0">
            {verdict.tone === "success" ? t("verdictAllowedBadge") : verdict.tone === "warn" ? t("verdictApprovalBadge") : t("verdictBlockedBadge")}
          </Badge>
          <span>{verdict.text}</span>
        </p>
      )}
    </div>
  );
}

/**
 * 브라우저 사이트 허용 목록(BROWSER_SITE_POLICY) 전용 편집기 — 시스템 설정 화면의 agent 그룹에서 JSON 입력란 대신 쓴다.
 * 저장은 기존 시스템 설정 API(onSave → PUT /api/admin/system-settings), 서버도 같은 검증(browserSitePolicyProblems)을 한다.
 */
export function BrowserSitePolicyEditor({ value, source, busy, onSave, onReset }: {
  value: string | undefined;
  source: "db" | "env" | "default";
  busy: boolean;
  onSave: (value: string) => void;
  onReset: () => void;
}) {
  const t = useTranslations("adminSystemSettings");
  const tp = useTranslations("adminSystemSettings.browserSitePolicy");
  const saved = useMemo(() => parseBrowserSitePolicy(value ?? ""), [value]);
  const [draft, setDraft] = useState<BrowserSitePolicy>(saved);

  useEffect(() => { setDraft(saved); }, [saved]);

  const draftJson = serialize(draft);
  const changed = draftJson !== serialize(saved);
  const problems = browserSitePolicyProblems(draftJson);
  const tooLong = problems.includes("too_long");
  const sourceLabel = source === "db" ? t("sourceDb") : source === "env" ? t("sourceEnv") : t("sourceDefault");

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs font-medium">{BROWSER_SITE_POLICY_SETTING_KEY}</code>
        <Badge tone={source === "db" ? "accent" : "neutral"} className="shrink-0 whitespace-nowrap">{sourceLabel}</Badge>
        {changed && <Badge tone="warn" className="shrink-0 whitespace-nowrap">{tp("unsaved")}</Badge>}
      </div>
      <p className="text-sm text-muted">{tp("help")}</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {LISTS.map((name) => (
          <PatternList key={name} name={name} patterns={draft[name]} disabled={busy}
            onChange={(next) => setDraft((d) => ({ ...d, [name]: next }))} />
        ))}
      </div>
      <PolicyTester policy={draft} />
      {problems.length > 0 && (
        <p className="text-xs text-danger" role="alert">
          {tooLong
            ? tp("tooLong", { length: draftJson.length, max: BROWSER_SITE_POLICY_MAX_JSON_CHARS })
            : tp("hasInvalid")}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" className="whitespace-nowrap" disabled={busy || !changed || problems.length > 0}
          onClick={() => onSave(draftJson)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {t("save")}
        </Button>
        {changed && (
          <Button variant="ghost" size="sm" className="whitespace-nowrap" disabled={busy} onClick={() => setDraft(saved)}>
            {tp("discard")}
          </Button>
        )}
        {source === "db" && (
          <Button variant="ghost" size="sm" className="whitespace-nowrap" disabled={busy}
            aria-label={t("reset")} title={t("resetHelp")} onClick={onReset}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t("reset")}
          </Button>
        )}
      </div>
    </div>
  );
}
