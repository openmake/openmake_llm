"use client";

/**
 * 모델 비교 모드 (2026-09-09).
 *
 * 화면을 두 패널로 나눠 서로 다른 모델이 같은 질문에 동시에 답하게 한다.
 * 패널마다 독립 소켓·세션·히스토리를 가지므로(useCompareLane) 멀티턴에서도 대화가 갈라진다.
 * 입력창은 하나 — 한 번의 전송이 두 레인에 같은 프롬프트를 같은 틱에 실어 보낸다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { RotateCcw, Send, Square } from "lucide-react";
import { ModelPicker, type PickerModel } from "@/components/model-picker";
import { Markdown } from "@/components/chat/markdown";
import { fetchModels } from "@/lib/models-api";
import { useAppStore } from "@/lib/store";
import { useCompareLane, type CompareLane, type CompareMessage } from "@/lib/use-compare-lane";
import { cn } from "@/lib/utils";

/** 두 레인의 모델 선택 보존 키 — 새로고침 후에도 같은 조합으로 이어서 비교하게 한다. */
const STORAGE_KEY = "openmake.compare.models";

function readStoredModels(): { a?: string; b?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { a?: unknown; b?: unknown };
    return {
      ...(typeof parsed.a === "string" ? { a: parsed.a } : {}),
      ...(typeof parsed.b === "string" ? { b: parsed.b } : {}),
    };
  } catch {
    return {};
  }
}

function writeStoredModels(a: string, b: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ a, b }));
  } catch {
    /* 프라이빗 모드 등 — 저장 실패는 무시(선택은 세션 내에서만 유지) */
  }
}

/** 한 레인의 메시지 목록 — 새 토큰마다 바닥으로 따라간다. */
function LaneMessages({ lane }: { lane: CompareLane }) {
  const t = useTranslations("compare");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 토큰이 늘 때마다 바닥 고정 — 단, 사용자가 위로 올려 읽는 중(바닥에서 멀어짐)이면 끌어내리지
  // 않는다. 두 패널이 동시에 스트리밍하므로 강제 스크롤은 더 거슬린다. 새 턴(길이 변화)은 항상 바닥.
  const tail = lane.messages[lane.messages.length - 1];
  const stickRef = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  useEffect(() => {
    stickRef.current = true;
  }, [lane.messages.length]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lane.messages.length, tail?.content, tail?.thinking]);

  if (lane.messages.length === 0) {
    return (
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <p className="text-center text-xs text-faint">{t("emptyPane")}</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      {lane.messages.map((m, i) => (
        <CompareBubble key={i} message={m} />
      ))}
    </div>
  );
}

function CompareBubble({ message }: { message: CompareMessage }) {
  const t = useTranslations("compare");
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-accent-soft px-3.5 py-2 text-sm text-fg">
          {message.content}
        </div>
      </div>
    );
  }
  const empty = message.content.trim().length === 0;
  return (
    <div className="min-w-0">
      {message.thinking && (
        <details className="mb-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
          <summary className="cursor-pointer text-xs text-muted">{t("thinking")}</summary>
          <div className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted">
            {message.thinking}
          </div>
        </details>
      )}
      {message.error ? (
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-danger">
          {message.content}
        </div>
      ) : empty && message.streaming ? (
        <span className="inline-block h-4 w-1.5 animate-pulse bg-accent align-text-bottom" />
      ) : (
        <div className="text-sm leading-relaxed text-fg">
          <Markdown content={message.content} />
          {message.streaming && (
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-text-bottom" />
          )}
        </div>
      )}
    </div>
  );
}

/** 한 패널 — 헤더(모델 선택 + 배지) + 메시지 목록. */
function LanePane({
  label,
  lane,
  models,
  value,
  onChange,
}: {
  label: string;
  lane: CompareLane;
  models: PickerModel[];
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("compare");
  // 폴백이 일어난 마지막 답변의 실제 모델 — 선택 모델과 다르면 헤더에 알린다.
  const served = useMemo(() => {
    for (let i = lane.messages.length - 1; i >= 0; i--) {
      const m = lane.messages[i];
      if (m.role === "assistant" && m.model) return m.model;
    }
    return null;
  }, [lane.messages]);
  const lastMetrics = useMemo(() => {
    for (let i = lane.messages.length - 1; i >= 0; i--) {
      const m = lane.messages[i];
      if (m.role === "assistant" && m.metrics) return m.metrics;
    }
    return null;
  }, [lane.messages]);

  return (
    <section className="flex min-h-0 min-w-0 flex-col border-border md:border-r md:last:border-r-0">
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-fg">{label}</span>
          <span
            className={cn(
              "text-[11px]",
              lane.connected ? "text-muted" : "text-danger",
            )}
          >
            {lane.connected ? (lastMetrics ? t("tokensPerSec", { value: lastMetrics.tokensPerSec }) : "") : t("notConnected")}
          </span>
        </div>
        <ModelPicker models={models} value={value} onChange={onChange} />
        {served && served !== value && (
          <p className="truncate text-[11px] text-warn" title={served}>
            {t("servedModel", { model: served })}
          </p>
        )}
      </div>
      <LaneMessages lane={lane} />
    </section>
  );
}

export function CompareView() {
  const t = useTranslations("compare");
  const laneA = useCompareLane("a");
  const laneB = useCompareLane("b");

  const currentUserId = useAppStore((s) => s.auth.currentUser?.id ?? null);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const { data: modelsData } = useQuery({
    queryKey: ["models", "chat", currentUserId ?? "guest"],
    queryFn: () => fetchModels({ chatOnly: true }),
    staleTime: 60_000,
  });
  const models: PickerModel[] = useMemo(() => modelsData?.models ?? [], [modelsData]);

  const [modelA, setModelA] = useState<string>("default");
  const [modelB, setModelB] = useState<string>("default");
  // 초기 1회만 기본값을 정한다 — 이후 사용자의 선택을 목록 로딩이 덮어쓰지 않게.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    const stored = readStoredModels();
    const a = stored.a ?? selectedModel ?? "default";
    // B 는 A 와 다른 첫 모델 — "비교"가 성립하려면 기본값부터 서로 달라야 한다.
    const b = stored.b ?? models.find((m) => m.modelId !== a)?.modelId ?? "default";
    if (!stored.a && !stored.b && models.length === 0) return; // 목록 도착 전이면 보류
    seededRef.current = true;
    setModelA(a);
    setModelB(b);
  }, [models, selectedModel]);

  useEffect(() => {
    if (!seededRef.current) return;
    writeStoredModels(modelA, modelB);
  }, [modelA, modelB]);

  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const anyStreaming = laneA.streaming || laneB.streaming;
  const bothConnected = laneA.connected && laneB.connected;
  const canSend = bothConnected && !anyStreaming && text.trim().length > 0;

  const submit = () => {
    const prompt = text.trim();
    if (!prompt || !bothConnected || anyStreaming) return;
    // 같은 틱에 두 레인으로 — 서버는 lane 접미사로 스트림을 분리해 서로를 끊지 않는다.
    laneA.send(prompt, modelA);
    laneB.send(prompt, modelB);
    setText("");
    const ta = taRef.current;
    if (ta) ta.style.height = "auto";
  };

  const stop = () => {
    laneA.abort();
    laneB.abort();
  };

  const reset = () => {
    laneA.reset();
    laneB.reset();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
        <LanePane
          label={t("laneA")}
          lane={laneA}
          models={models}
          value={modelA}
          onChange={setModelA}
        />
        <LanePane
          label={t("laneB")}
          lane={laneB}
          models={models}
          value={modelB}
          onChange={setModelB}
        />
      </div>

      <div className="shrink-0 border-t border-border bg-app px-4 py-3">
        <div className="mx-auto w-full max-w-3xl rounded-2xl border border-border bg-surface shadow-2">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
            }}
            onKeyDown={(e) => {
              // IME 조합 중 Enter 는 조합 확정으로 keydown 이 한 번 더 발생해 이중 전송이 된다.
              // keyCode 229 는 isComposing 이 false 로 오는 WebKit 조합 커밋 보강.
              if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={t("placeholder")}
            className="block w-full resize-none bg-transparent px-4 pt-2.5 text-sm text-fg outline-none placeholder:text-muted"
          />
          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted transition hover:bg-surface-2 hover:text-fg"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t("reset")}
            </button>
            <div className="flex items-center gap-1.5">
              {/* 같은 모델을 고른 경우(목록이 하나뿐일 때 포함) — 비교가 성립하지 않음을 알린다. */}
              {modelA === modelB && (
                <span className="text-[11px] text-warn">{t("sameModelHint")}</span>
              )}
              {!bothConnected && (
                <span className="text-[11px] text-danger">{t("notConnected")}</span>
              )}
              {anyStreaming ? (
                <button
                  type="button"
                  onClick={stop}
                  aria-label={t("stop")}
                  title={t("stop")}
                  className="grid h-8 w-8 place-items-center rounded-md bg-surface-2 text-fg transition hover:bg-surface-3"
                >
                  <Square className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSend}
                  aria-label={t("send")}
                  title={t("send")}
                  className="grid h-8 w-8 place-items-center rounded-md bg-accent text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
                >
                  <Send className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
