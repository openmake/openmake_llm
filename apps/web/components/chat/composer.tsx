"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  Globe,
  KeyRound,
  MessagesSquare,
  Sparkles,
  Square,
  Telescope,
  Brain,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useChatSocket } from "@/lib/use-chat-socket";
import { fetchModels } from "@/lib/models-api";
import { cn } from "@/lib/utils";

export function Composer() {
  const { sendChat, abort } = useChatSocket();
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 로컬 vLLM + 등록된 외부 LLM(OpenRouter 등) 통합 모델 목록
  const { data: modelsData } = useQuery({
    queryKey: ["models"],
    queryFn: fetchModels,
    staleTime: 60_000,
  });
  const models = modelsData?.models ?? [];

  const {
    isGenerating,
    thinkingEnabled,
    discussionMode,
    deepResearchMode,
    webSearchEnabled,
    agentTaskMode,
    selectedModel,
    style,
    inputDraft,
    toggle,
    setSelectedModel,
    cycleStyle,
    setInputDraft,
  } = useAppStore();

  // 모델 목록 로드 시 현재 selectedModel 이 목록에 없으면 defaultModel 로 동기화
  useEffect(() => {
    if (!modelsData) return;
    if (!modelsData.models.some((m) => m.modelId === selectedModel)) {
      setSelectedModel(modelsData.defaultModel);
    }
    // selectedModel 변동마다 재실행 불필요 — 목록 로드 시점에만 보정
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsData]);

  const submit = () => {
    if (!text.trim() || isGenerating) return;
    sendChat(text.trim());
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  // 빠른 시작 카드(message-list)에서 설정한 draft 를 textarea 에 prefill 후 소비.
  useEffect(() => {
    if (!inputDraft) return;
    setText(inputDraft);
    setInputDraft("");
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  }, [inputDraft, setInputDraft]);

  const TOGGLES = [
    { key: "discussionMode" as const, on: discussionMode, icon: MessagesSquare, label: "토론" },
    { key: "thinkingEnabled" as const, on: thinkingEnabled, icon: Brain, label: "Thinking" },
    { key: "deepResearchMode" as const, on: deepResearchMode, icon: Telescope, label: "딥 리서치" },
    { key: "webSearchEnabled" as const, on: webSearchEnabled, icon: Globe, label: "웹" },
    { key: "agentTaskMode" as const, on: agentTaskMode, icon: Sparkles, label: "에이전트" },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="rounded-xl border border-border bg-surface shadow-2">
        {/* 모드 토글 — 가로 스크롤 칩 (OD lumen 모바일 시안: 컴포저 상단) */}
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 pt-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TOGGLES.map((t) => (
            <button
              key={t.key}
              onClick={() => toggle(t.key)}
              title={t.label}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
                t.on
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="메시지를 입력하거나 / 로 스킬을 호출하세요..."
          className="block w-full resize-none bg-transparent px-4 pt-2.5 text-sm text-fg outline-none placeholder:text-faint"
        />

        {/* 하단: 모델 셀렉터(로컬 + 외부 LLM) + 키 관리 + 스타일 + 전송 */}
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            title="모델 선택 (로컬 + 등록한 외부 LLM)"
            className="max-w-[40%] truncate rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs font-medium text-fg outline-none"
          >
            {models.length === 0 && <option value="">모델 로딩…</option>}
            {models.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.name}
                {m.isFree ? " · 무료" : ""}
                {m.available === false ? " (불가)" : ""}
              </option>
            ))}
          </select>

          <Link
            href="/api-keys"
            title="외부 LLM(OpenRouter 등) 키 등록·관리"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <KeyRound className="h-4 w-4" />
          </Link>

          <button
            onClick={cycleStyle}
            className="rounded-md px-2 py-1.5 text-xs font-medium capitalize text-muted hover:bg-surface-2 hover:text-fg"
            title="응답 스타일"
          >
            {style}
          </button>

          {isGenerating ? (
            <button
              onClick={abort}
              aria-label="중단"
              className="ml-auto grid h-8 w-8 place-items-center rounded-md bg-surface-3 text-fg transition hover:bg-border-strong"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim()}
              aria-label="전송"
              className="ml-auto grid h-8 w-8 place-items-center rounded-md bg-accent text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-faint">
        OpenMake 는 실수할 수 있습니다. 중요한 정보는 확인하세요.
      </p>
    </div>
  );
}
