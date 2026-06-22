"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Image from "next/image";
import { MessagesSquare, Telescope, Brain, Sparkles, FileCode2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { Markdown } from "./markdown";
import { cn } from "@/lib/utils";

const ARTIFACT_PLACEHOLDER = /\[\[artifact:([^\]]+)\]\]/g;

/** 영속화된 `[[artifact:id]]` placeholder 를 클릭 가능한 아티팩트 칩으로 렌더. */
function ArtifactChip({ id }: { id: string }) {
  const artifacts = useAppStore((s) => s.artifacts);
  const setActiveArtifact = useAppStore((s) => s.setActiveArtifact);
  const setArtifactPanelOpen = useAppStore((s) => s.setArtifactPanelOpen);
  const title = artifacts.find((a) => a.id === id)?.title ?? "아티팩트";
  return (
    <button
      type="button"
      onClick={() => {
        setActiveArtifact(id);
        setArtifactPanelOpen(true);
      }}
      className="my-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm font-medium text-fg-2 transition hover:bg-surface-3 hover:text-fg"
    >
      <FileCode2 className="h-4 w-4 text-accent" />
      {title}
    </button>
  );
}

/** assistant 본문 — `[[artifact:id]]` placeholder 를 칩으로, 나머지는 Markdown 으로. */
function AssistantContent({ content }: { content: string }) {
  if (!content.includes("[[artifact:")) return <Markdown content={content} />;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(ARTIFACT_PLACEHOLDER);
  let idx = 0;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      const text = content.slice(last, m.index).trim();
      if (text) nodes.push(<Markdown key={`t${idx}`} content={text} />);
    }
    nodes.push(<ArtifactChip key={`a${idx}`} id={m[1]} />);
    last = m.index + m[0].length;
    idx += 1;
  }
  const tail = content.slice(last).trim();
  if (tail) nodes.push(<Markdown key="tail" content={tail} />);
  return <>{nodes}</>;
}

const QUICK_STARTS = [
  { icon: MessagesSquare, label: "요약하기", prompt: "다음 내용을 요약해 줘:\n\n" },
  { icon: Telescope, label: "리서치", prompt: "다음 주제를 깊이 리서치해 줘:\n\n" },
  { icon: Brain, label: "단계별 분석", prompt: "다음 문제를 단계별로 분석해 줘:\n\n" },
  { icon: Sparkles, label: "브레인스토밍", prompt: "다음에 대해 브레인스토밍하자:\n\n" },
];

export function MessageList() {
  const chatHistory = useAppStore((s) => s.chatHistory);
  const setInputDraft = useAppStore((s) => s.setInputDraft);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  if (chatHistory.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Image
          src="/logo.png"
          alt="OpenMake"
          width={56}
          height={56}
          className="h-14 w-14 rounded-2xl object-contain"
        />
        <h2 className="mt-5 text-2xl font-bold text-fg">무엇을 도와드릴까요?</h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          멀티모델 오케스트레이션 · MCP 도구 · 딥 리서치 · 자율 에이전트.
          아래에 질문을 입력하거나 <span className="font-mono text-accent">/</span> 로 스킬을 호출하세요.
        </p>

        <div className="mt-7 grid w-full max-w-md grid-cols-2 gap-2.5">
          {QUICK_STARTS.map((q) => (
            <button
              key={q.label}
              onClick={() => setInputDraft(q.prompt)}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-3 text-left text-sm font-medium text-fg transition hover:border-border-strong hover:bg-surface-2"
            >
              <q.icon className="h-4 w-4 shrink-0 text-accent" />
              <span className="truncate">{q.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      {chatHistory.map((m, i) =>
        m.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-accent-soft px-4 py-2.5 text-sm text-fg">
              {m.content}
            </div>
          </div>
        ) : m.role === "system" ? (
          <div key={i} className="flex justify-center">
            <div className="rounded-md bg-danger-soft px-3 py-1.5 text-xs text-danger">
              {m.content}
            </div>
          </div>
        ) : (
          <div key={i} className="flex gap-3">
            <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-xs font-bold text-accent-fg">
              AI
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs font-medium text-muted">OpenMake</p>
              <div className="text-sm leading-relaxed text-fg">
                <AssistantContent content={m.content} />
                {m.streaming && (
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-text-bottom" />
                )}
              </div>
            </div>
          </div>
        ),
      )}
      <div ref={bottomRef} className={cn("h-px")} />
    </div>
  );
}
