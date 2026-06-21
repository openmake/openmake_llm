"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { useAppStore } from "@/lib/store";
import { Markdown } from "./markdown";
import { cn } from "@/lib/utils";

export function MessageList() {
  const chatHistory = useAppStore((s) => s.chatHistory);
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
                <Markdown content={m.content} />
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
