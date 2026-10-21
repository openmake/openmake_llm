"use client";

/**
 * 실시간 작업 화면 — 작업 상세 오른쪽에 에이전트 브라우저의 마지막 화면과 터미널 출력 끝부분을 보여 준다.
 * 보기 전용(클릭 처리 없음). 조작이 필요하면 기존 "브라우저 넘겨받기"를 쓴다.
 * 실행 중·탭이 보일 때만 1초마다 다시 읽고, 끝난 작업은 한 번만 읽는다.
 * 백엔드: routes/agent-task-live.routes.ts (소유자 전용 — 대상이 아니면 200 + eligible:false, 403·404 도 조용히 숨긴다.
 * 일시 오류(5xx·네트워크)는 마지막 내용을 그대로 두고 다음 폴링에서 다시 읽는다)
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiClient, ApiError } from "@/lib/api-client";
import { frameAgeSeconds, ineligibleRecheckDelay, isLiveViewHiddenError, nextLivePollDelay, shouldFollowTail } from "@/lib/live-view";
import { cn } from "@/lib/utils";

interface LiveBrowser { image: string | null; unchanged?: boolean; url: string; title: string; at: number }
interface LiveTerminal {
  command: string;
  output: string;
  truncatedHead: boolean;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
}
type LiveResponse = {
  data?: { eligible: false; reason?: string } | { eligible: true; status: string; browser: LiveBrowser | null; terminal: LiveTerminal | null };
};
type Tab = "screen" | "terminal";

export function LiveView({ taskId, status, onEligibleChange }: {
  taskId: string;
  status: string | undefined;
  /** 대상 여부가 정해지거나 바뀔 때 — 부모가 두 칸 배치·모달 폭을 정한다 */
  onEligibleChange?: (eligible: boolean) => void;
}) {
  const t = useTranslations("agentTasks.live");
  // null = 아직 모름, false = 대상 아님(아무것도 그리지 않는다)
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [browser, setBrowser] = useState<LiveBrowser | null>(null);
  const [terminal, setTerminal] = useState<LiveTerminal | null>(null);
  // 프레임 경과 시간 계산 기준 — 렌더 중 Date.now() 를 부르지 않도록 받은 시각을 둔다
  const [receivedAt, setReceivedAt] = useState(0);
  const [pickedTab, setPickedTab] = useState<Tab | null>(null);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const eligibleRef = useRef<boolean | null>(null);
  const loadedOnce = useRef(false);
  // 마지막으로 받은 browser.at — 화면이 그대로면 서버가 이미지를 다시 보내지 않는다
  const frameAt = useRef<number | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  /** 사용자가 맨 아래 근처에 있는지 — 위로 올려 읽는 중이면 새 출력에 끌어내리지 않는다. */
  const followTail = useRef(true);
  // 부모 콜백은 ref 로 — 바뀔 때마다 폴링 효과를 다시 돌리지 않도록
  const onEligibleRef = useRef(onEligibleChange);
  useEffect(() => { onEligibleRef.current = onEligibleChange; }, [onEligibleChange]);

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  // 상태·보임이 바뀌면 다시 계산한다 — 끝난 작업도 마지막 상태(종료 코드)를 한 번 더 읽는다.
  // 대상 아님도 상태가 바뀌면 한 번 다시 묻는다(대기 중엔 작업 폴더가 없어 not_sandbox → 시작 뒤엔 대상).
  // 상태가 그대로여도 바뀔 수 있는 이유(not_sandbox·workspace_gone)면 ineligibleRecheckDelay 간격으로 다시 묻는다.
  useEffect(() => {
    if (loadedOnce.current && !visible) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const decide = (next: boolean) => {
      if (eligibleRef.current === next) return;
      eligibleRef.current = next;
      setEligible(next);
      onEligibleRef.current?.(next);
    };
    const load = async () => {
      let nextStatus: string | undefined = status;
      try {
        const q = frameAt.current !== null ? `?frameAt=${frameAt.current}` : "";
        const r = await ApiClient.get<LiveResponse>(`/api/agent-tasks/${taskId}/live${q}`, { redirectOnUnauthorized: false });
        if (!alive) return;
        const d = r?.data;
        if (!d || !d.eligible) {
          decide(false);
          // 작업 폴더가 아직 없는 진행 중 작업(시작·재개 직후)은 잠시 뒤 다시 묻는다 — 대상이 되면 위 1초 폴링으로 넘어간다
          const recheck = ineligibleRecheckDelay({ reason: d?.eligible === false ? d.reason : undefined, status, visible });
          if (recheck !== null) timer = setTimeout(() => void load(), recheck);
          return;
        }
        decide(true);
        nextStatus = d.status;
        const b = d.browser;
        // unchanged — 갖고 있던 이미지를 그대로 쓴다
        setBrowser((prev) => (b?.unchanged ? { ...b, image: prev?.image ?? null } : b));
        frameAt.current = b?.at ?? null;
        setTerminal(d.terminal);
        setReceivedAt(Date.now());
        loadedOnce.current = true;
      } catch (e) {
        if (!alive) return;
        // 403(소유자·관리자 아님)·404 — 조용히 숨긴다. 그 밖은 일시 오류 — 마지막 내용을 두고 아래에서 다시 잡는다.
        if (isLiveViewHiddenError(e instanceof ApiError ? e.status : undefined)) { decide(false); return; }
      }
      const delay = nextLivePollDelay({ status: nextStatus, visible, eligible: eligibleRef.current });
      if (alive && delay !== null) timer = setTimeout(() => void load(), delay);
    };
    void load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [taskId, status, visible]);

  // 기본 탭: 터미널이 브라우저보다 최근이면 터미널. 사용자가 고른 뒤에는 바꾸지 않는다.
  const terminalAt = terminal ? Math.max(terminal.startedAt, terminal.endedAt ?? 0) : null;
  const autoTab: Tab = terminalAt !== null && (!browser || terminalAt > browser.at) ? "terminal" : "screen";
  const tab = pickedTab ?? autoTab;

  // 터미널 탭으로 오면 맨 아래부터, 새 출력은 맨 아래 근처에 있을 때만 따라간다
  const output = terminal?.output;
  useEffect(() => { followTail.current = true; }, [tab]);
  useEffect(() => {
    const el = preRef.current;
    if (el && followTail.current) el.scrollTop = el.scrollHeight;
  }, [output, tab]);

  if (!eligible) return null;

  const age = browser ? frameAgeSeconds(browser.at, receivedAt) : null;
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "screen", label: t("tabScreen") },
    { id: "terminal", label: t("tabTerminal") },
  ];

  return (
    <section className="rounded-md border border-border bg-surface-1 p-3" aria-label={t("title")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-fg-2">{t("title")}</p>
          <p className="text-[11px] text-muted">{t("ownerOnly")}</p>
        </div>
        <div role="tablist" className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setPickedTab(x.id)}
              className={cn(
                "rounded px-2.5 py-1 text-xs transition",
                tab === x.id ? "bg-surface-1 font-medium text-fg shadow-sm" : "text-muted hover:text-fg",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "screen" ? (
        <div role="tabpanel" aria-label={t("tabScreen")}>
          {browser?.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- base64 스크린샷이라 next/image 최적화 대상이 아니다
            <img
              src={`data:image/jpeg;base64,${browser.image}`}
              alt={browser.title || browser.url}
              className="w-full rounded border border-border bg-black/5"
            />
          ) : (
            <p className="py-8 text-center text-xs text-muted">{t("noFrame")}</p>
          )}
          {browser && (
            <div className="mt-2 space-y-0.5 text-[11px]">
              {browser.title && <p className="truncate text-fg-2" title={browser.title}>{browser.title}</p>}
              {browser.url && <p className="truncate font-mono text-muted" title={browser.url}>{browser.url}</p>}
              {age !== null && <p className="text-faint">{t("frameAge", { seconds: age })}</p>}
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label={t("tabTerminal")}>
          {terminal ? (
            <>
              <pre
                ref={preRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  followTail.current = shouldFollowTail(el.scrollTop, el.clientHeight, el.scrollHeight);
                }}
                className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 px-2 py-1.5 font-mono text-xs leading-relaxed text-fg-2"
              >
                {terminal.truncatedHead && <span className="block text-faint">… {t("truncated")}</span>}
                <span className="block text-fg">$ {terminal.command}</span>
                {terminal.output}
              </pre>
              <p className="mt-1.5 text-[11px] text-muted">
                {terminal.endedAt === null
                  ? t("running")
                  : terminal.exitCode !== null && t("exitCode", { code: terminal.exitCode })}
              </p>
            </>
          ) : (
            <p className="py-8 text-center text-xs text-muted">{t("noTerminal")}</p>
          )}
        </div>
      )}
    </section>
  );
}
