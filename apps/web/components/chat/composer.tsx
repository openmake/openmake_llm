"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  Globe,
  MessagesSquare,
  Sparkles,
  Square,
  Telescope,
  Brain,
  Paperclip,
  X,
} from "lucide-react";
import type { WsAttachedFile } from "@openmake/shared-types";
import { useAppStore } from "@/lib/store";
import { useChatSocket } from "@/lib/use-chat-socket";
import { fetchModels } from "@/lib/models-api";
import { cn } from "@/lib/utils";

// 클라이언트 첨부 캡 — 백엔드 FILE_ATTACH_LIMITS 기본값과 일치(서버가 재절단하므로 advisory).
const MAX_FILES = 10;
const MAX_CHARS_PER_FILE = 100_000;
const MAX_TOTAL_CHARS = 300_000;
// 텍스트로 읽을 수 있는 확장자(바이너리는 미전송 — 백엔드 계약). vision 이미지는 별도 채널.
const TEXT_ACCEPT =
  ".txt,.md,.markdown,.json,.csv,.tsv,.log,.xml,.yaml,.yml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.go,.rs,.c,.cpp,.h,.sh,.sql,.env,.ini,.toml,text/*";

/** 파일을 텍스트로 읽는다(바이너리는 깨질 수 있으나 백엔드가 처리). */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => resolve("");
    r.readAsText(file);
  });
}

export function Composer() {
  const { sendChat, abort } = useChatSocket();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<WsAttachedFile[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 선택한 파일들을 텍스트로 읽어 캡 적용 후 첨부 목록에 추가
  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const next = [...files];
    let total = next.reduce((n, f) => n + (f.content?.length ?? 0), 0);
    for (const file of Array.from(list)) {
      if (next.length >= MAX_FILES || total >= MAX_TOTAL_CHARS) break;
      let content = await readFileText(file);
      let truncated = false;
      if (content.length > MAX_CHARS_PER_FILE) {
        content = content.slice(0, MAX_CHARS_PER_FILE);
        truncated = true;
      }
      if (total + content.length > MAX_TOTAL_CHARS) {
        content = content.slice(0, Math.max(0, MAX_TOTAL_CHARS - total));
        truncated = true;
      }
      total += content.length;
      next.push({
        id: crypto.randomUUID(),
        name: file.name.slice(0, 200),
        type: file.type || "text/plain",
        content,
        size: file.size,
        truncated,
      });
    }
    setFiles(next);
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  // 로컬 vLLM + 등록된 외부 LLM(OpenRouter 등) 통합 모델 목록
  const { data: modelsData } = useQuery({
    queryKey: ["models"],
    queryFn: fetchModels,
    staleTime: 60_000,
  });
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
    if ((!text.trim() && files.length === 0) || isGenerating) return;
    sendChat(text.trim(), undefined, files.length ? files : undefined);
    setText("");
    setFiles([]);
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

        {/* 첨부 파일 칩 */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2">
            {files.map((f) => (
              <span
                key={f.id}
                title={f.truncated ? `${f.name} (길이 초과로 일부만 첨부)` : f.name}
                className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-fg"
              >
                <Paperclip className="h-3 w-3 shrink-0 text-muted" />
                <span className="truncate">{f.name}</span>
                {f.truncated && <span className="shrink-0 text-faint">✂</span>}
                <button
                  onClick={() => removeFile(f.id)}
                  aria-label={`${f.name} 첨부 제거`}
                  className="shrink-0 text-muted hover:text-fg"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

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

        {/* 하단: 스타일 + 전송 (모델 선택은 설정 → 기본 모델에서, 채팅창엔 모델명 비표시) */}
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1">
          {/* 파일 첨부 */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={TEXT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = ""; // 같은 파일 재선택 허용
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={files.length >= MAX_FILES}
            className="grid h-8 w-8 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            title={files.length >= MAX_FILES ? `최대 ${MAX_FILES}개까지 첨부` : "파일 첨부 (텍스트)"}
            aria-label="파일 첨부"
          >
            <Paperclip className="h-4 w-4" />
          </button>

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
              disabled={!text.trim() && files.length === 0}
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
