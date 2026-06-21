"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Globe,
  MessagesSquare,
  Sparkles,
  Square,
  Telescope,
  Brain,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useChatSocket } from "@/lib/use-chat-socket";
import { cn } from "@/lib/utils";

const MODELS = [
  { id: "default", label: "Auto" },
  { id: "pro", label: "Pro" },
  { id: "fast", label: "Fast" },
  { id: "think", label: "Think" },
  { id: "code", label: "Code" },
  { id: "vision", label: "Vision" },
];

export function Composer() {
  const { sendChat, abort } = useChatSocket();
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

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
          className="block w-full resize-none bg-transparent px-4 pt-3.5 text-sm text-fg outline-none placeholder:text-faint"
        />

        <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1">
          {/* 모델 셀렉터 */}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs font-medium text-fg outline-none"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          {/* 모드 토글 */}
          <div className="flex flex-wrap items-center gap-1">
            {TOGGLES.map((t) => (
              <button
                key={t.key}
                onClick={() => toggle(t.key)}
                title={t.label}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition",
                  t.on
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>

          {/* 스타일 cycle */}
          <button
            onClick={cycleStyle}
            className="ml-auto rounded-md px-2 py-1.5 text-xs font-medium capitalize text-muted hover:bg-surface-2 hover:text-fg"
            title="응답 스타일"
          >
            {style}
          </button>

          {/* 전송 / 중단 */}
          {isGenerating ? (
            <button
              onClick={abort}
              aria-label="중단"
              className="grid h-8 w-8 place-items-center rounded-md bg-surface-3 text-fg transition hover:bg-border-strong"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim()}
              aria-label="전송"
              className="grid h-8 w-8 place-items-center rounded-md bg-accent text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
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
