"use client";

/**
 * 브라우저 넘겨받기(Take control) — 에이전트가 로그인·CAPTCHA 에서 막혔을 때 사용자가 그 브라우저를 직접 조작한다.
 * 화면은 주기적 스크린샷이고, 클릭·키·스크롤·주소 이동은 서버를 거쳐 세션 컨테이너로 간다.
 * "돌려주기"를 누르면 로그인 상태가 저장되고 에이전트의 다음 browser 호출이 그 상태로 시작한다.
 * 백엔드: routes/agent-task-browser-session.routes.ts
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, MousePointerClick, Undo2 } from "lucide-react";
import { ApiClient, ApiError } from "@/lib/api-client";
import { keyToInput, toViewportPoint } from "@/lib/browser-takeover";
import {
  BROWSER_TAKEOVER_INPUT_SETTLE_MS, BROWSER_TAKEOVER_POLL_MS, BROWSER_TAKEOVER_SCROLL_FLUSH_MS,
} from "@/lib/constants/ui-limits";

interface Frame { image: string | null; url: string; title: string }
type SessionInput =
  | { op: "click"; x: number; y: number }
  | { op: "type"; text: string }
  | { op: "key"; key: string }
  | { op: "scroll"; dy: number }
  | { op: "goto"; url: string }
  | { op: "back" };

const base = (taskId: string) => `/api/agent-tasks/${taskId}/browser-session`;

export function BrowserTakeover({ taskId }: { taskId: string }) {
  const t = useTranslations("agentTasks.takeover");
  // null = 아직 모름, false = 이 작업은 넘겨받을 수 없음(버튼을 숨긴다)
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [active, setActive] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    ApiClient.get<{ data: { active: boolean } }>(base(taskId), { redirectOnUnauthorized: false })
      .then((r) => { if (alive) { setEligible(true); setActive(!!r?.data?.active); } })
      .catch(() => { if (alive) setEligible(false); });
    return () => { alive = false; };
  }, [taskId]);

  async function start() {
    setBusy(true);
    setNotice(null);
    try {
      await ApiClient.post(base(taskId), {});
      setActive(true);
      setOpen(true);
    } catch (e) {
      setNotice(t("startFailed", { error: e instanceof Error ? e.message : "" }));
    } finally {
      setBusy(false);
    }
  }

  const onEnded = useCallback((released: boolean) => {
    setOpen(false);
    setActive(false);
    setNotice(released ? t("released") : t("ended"));
  }, [t]);

  if (!eligible) return null;
  return (
    <div className="mt-1 rounded-md border border-border bg-surface-2/50 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => (active ? setOpen(true) : void start())}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-xs font-medium text-fg-2 transition hover:bg-surface-3 hover:text-fg disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MousePointerClick className="h-3.5 w-3.5" />}
          {active ? t("reopen") : t("start")}
        </button>
        <p className="text-[11px] text-muted">{notice ?? (active ? t("activeHint") : t("hint"))}</p>
      </div>
      {open && <TakeoverDialog taskId={taskId} onEnded={onEnded} onHide={() => setOpen(false)} />}
    </div>
  );
}

function TakeoverDialog({ taskId, onEnded, onHide }: { taskId: string; onEnded: (released: boolean) => void; onHide: () => void }) {
  const t = useTranslations("agentTasks.takeover");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [address, setAddress] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const addressDirty = useRef(false);
  // 스크린샷 요청이 겹치지 않게 — 진행 중이면 건너뛴다(다음 폴링이 받는다)
  const loading = useRef(false);
  const alive = useRef(true);
  const pendingScroll = useRef(0);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const r = await ApiClient.get<{ data: Frame }>(`${base(taskId)}/screenshot`, { redirectOnUnauthorized: false });
      if (!alive.current) return;
      const next = r?.data;
      if (next) {
        // 이동 중이라 캡처가 없으면 직전 화면을 유지한다
        setFrame((prev) => (next.image ? next : prev ? { ...prev, url: next.url || prev.url } : next));
        if (!addressDirty.current && next.url) setAddress(next.url);
      }
    } catch (e) {
      if (!alive.current) return;
      // 409 — 세션이 끝났다(유휴 상한·작업 종료)
      if (e instanceof ApiError && e.status === 409) { onEnded(false); return; }
    } finally {
      loading.current = false;
    }
  }, [taskId, onEnded]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), BROWSER_TAKEOVER_POLL_MS);
    screenRef.current?.focus();
    return () => {
      alive.current = false;
      clearInterval(timer);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
  }, [refresh]);

  const send = useCallback(async (input: SessionInput) => {
    setError(null);
    try {
      const r = await ApiClient.post<{ data: { ok: boolean; error?: string } }>(`${base(taskId)}/input`, input);
      if (r?.data && !r.data.ok) setError(t("inputFailed", { error: r.data.error ?? "" }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { onEnded(false); return; }
      setError(t("inputFailed", { error: e instanceof Error ? e.message : "" }));
    }
    // 화면이 바뀔 틈을 준 뒤 바로 다시 받는다
    setTimeout(() => { if (alive.current) void refresh(); }, BROWSER_TAKEOVER_INPUT_SETTLE_MS);
  }, [taskId, t, onEnded, refresh]);

  function onScreenClick(e: React.MouseEvent) {
    const img = imgRef.current;
    if (!img) return;
    const p = toViewportPoint(e.clientX, e.clientY, img.getBoundingClientRect(), { width: img.naturalWidth, height: img.naturalHeight });
    screenRef.current?.focus();
    if (p) void send({ op: "click", ...p });
  }

  function onScreenKeyDown(e: React.KeyboardEvent) {
    const input = keyToInput({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing });
    if (!input) return;
    e.preventDefault();
    void send(input);
  }

  function onScreenWheel(e: React.WheelEvent) {
    // 휠 이벤트는 잘게 쏟아진다 — 모아서 한 번에 보낸다
    pendingScroll.current += e.deltaY;
    if (scrollTimer.current) return;
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = null;
      const dy = Math.max(-5000, Math.min(5000, Math.round(pendingScroll.current)));
      pendingScroll.current = 0;
      if (dy !== 0) void send({ op: "scroll", dy });
    }, BROWSER_TAKEOVER_SCROLL_FLUSH_MS);
  }

  function go() {
    const raw = address.trim();
    if (!raw) return;
    addressDirty.current = false;
    void send({ op: "goto", url: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` });
  }

  function sendText() {
    if (!text) return;
    void send({ op: "type", text });
    setText("");
  }

  async function release() {
    setReleasing(true);
    try {
      await ApiClient.del(base(taskId));
      onEnded(true);
    } catch (e) {
      setError(t("releaseFailed", { error: e instanceof Error ? e.message : "" }));
      setReleasing(false);
    }
  }

  const fieldClass = "min-w-0 flex-1 rounded-md border border-border bg-surface-1 px-2 py-1.5 text-xs text-fg outline-none";
  const buttonClass = "shrink-0 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-xs font-medium text-fg-2 transition hover:bg-surface-3 hover:text-fg disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-3 lg:p-6" role="dialog" aria-modal="true" aria-label={t("title")}>
      <div className="mx-auto flex min-h-0 w-full max-w-[1320px] flex-1 flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-fg">{t("title")}</p>
          <p className="min-w-0 flex-1 truncate text-[11px] text-muted">{t("notice")}</p>
          <button type="button" onClick={onHide} className={buttonClass}>{t("hide")}</button>
          <button
            type="button"
            disabled={releasing}
            onClick={() => void release()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {releasing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
            {t("release")}
          </button>
        </div>

        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <button type="button" aria-label={t("back")} title={t("back")} onClick={() => void send({ op: "back" })} className={buttonClass}>
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <input
            value={address}
            onChange={(e) => { addressDirty.current = true; setAddress(e.target.value); }}
            placeholder={t("addressPlaceholder")}
            aria-label={t("addressPlaceholder")}
            className={fieldClass}
          />
          <button type="submit" className={buttonClass}>{t("go")}</button>
        </form>

        <div
          ref={screenRef}
          tabIndex={0}
          role="application"
          aria-label={frame?.title || t("screen")}
          onKeyDown={onScreenKeyDown}
          onWheel={onScreenWheel}
          className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-md border border-border bg-surface-2 outline-none focus:border-accent"
        >
          {frame?.image ? (
            // 스크린샷(data URL) — next/image 최적화 대상이 아니다
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={`data:image/jpeg;base64,${frame.image}`}
              alt={frame.title || t("screen")}
              onClick={onScreenClick}
              draggable={false}
              className="max-h-full max-w-full cursor-pointer select-none object-contain"
            />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          )}
        </div>

        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); sendText(); }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("textPlaceholder")}
            aria-label={t("textPlaceholder")}
            maxLength={2000}
            className={fieldClass}
          />
          <button type="submit" disabled={!text} className={buttonClass}>{t("sendText")}</button>
        </form>
        {error && <p className="text-[11px] text-danger">{error}</p>}
      </div>
    </div>
  );
}
