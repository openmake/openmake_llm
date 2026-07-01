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
  Image as ImageIcon,
  FileCode2,
  LayoutList,
  SlidersHorizontal,
  Check,
  Paperclip,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { WsAttachedFile } from "@openmake/shared-types";
import { useAppStore } from "@/lib/store";
import { useChatSocket } from "@/lib/use-chat-socket";
import { fetchModels } from "@/lib/models-api";
import {
  fetchSkills,
  groupSkillsByCategory,
  skillSlug,
  type SkillSummary,
} from "@/lib/skills-api";
import { SlashSkillMenu } from "@/components/chat/slash-skill-menu";
import { cn } from "@/lib/utils";

// 슬래시 스킬 호출: "/" + 공백없는 단일 토큰일 때만 드롭다운 표시.
const SLASH_PATTERN = /^\/(\S*)$/;

// 클라이언트 첨부 캡 — 백엔드 FILE_ATTACH_LIMITS 기본값과 일치(서버가 재절단하므로 advisory).
const MAX_FILES = 50;
const MAX_IMAGES = 20;
const MAX_CHARS_PER_FILE = 2_000_000;
const MAX_TOTAL_CHARS = 10_000_000;
// 모든 파일 타입 허용(accept 미지정). 처리 분기:
//  - 이미지(image/*) → base64 data URL → vision 채널(images)
//  - 문서(EXTRACT_EXTS: PDF/Word/Excel/PowerPoint 등) → base64 원본(data) → 백엔드가 텍스트 추출
//  - 그 외 → 텍스트로 읽어 content (바이너리는 깨질 수 있으나 백엔드가 메타로 처리)
const EXTRACT_EXTS = ["pdf", "docx", "xlsx", "pptx", "odt", "odp", "ods", "rtf"];

const extOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
};

/** 파일을 텍스트로 읽는다(바이너리는 깨질 수 있으나 백엔드가 처리). */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => resolve("");
    r.readAsText(file);
  });
}

/** 이미지를 base64 data URL 로 읽는다(vision 채널 전송용). */
function readFileDataURL(file: File): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => resolve("");
    r.readAsDataURL(file);
  });
}

/** 문서 바이너리를 순수 base64(data URL prefix 제외)로 읽는다(백엔드 추출용). */
function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => {
      const s = typeof r.result === "string" ? r.result : "";
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : "");
    };
    r.onerror = () => resolve("");
    r.readAsDataURL(file);
  });
}

export function Composer() {
  const t = useTranslations("composer");
  const { sendChat, abort, startAgentTask, sendStructured } = useChatSocket();
  const router = useRouter();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<WsAttachedFile[]>([]);
  // 이미지 첨부 — base64 data URL 로 vision 채널 전송. 미리보기/제거를 위해 메타와 함께 보관.
  const [images, setImages] = useState<{ id: string; name: string; dataUrl: string }[]>([]);
  // 드래그앤드롭 오버레이 표시 상태
  const [dragging, setDragging] = useState(false);
  // 모드 시트(모바일 최적화) — 7개 토글을 가로스크롤 칩 대신 '도구' 버튼 + 시트로 수납
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 선택/드롭한 파일들을 타입별로 분기해 첨부 목록에 추가.
  // 이미지 → base64 vision, 그 외 → 텍스트(캡 적용). 모든 파일 타입 허용.
  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const nextFiles = [...files];
    const nextImages = [...images];
    let total = nextFiles.reduce((n, f) => n + (f.content?.length ?? 0), 0);
    for (const file of Array.from(list)) {
      if (file.type.startsWith("image/")) {
        if (nextImages.length >= MAX_IMAGES) continue;
        const dataUrl = await readFileDataURL(file);
        if (!dataUrl) continue;
        nextImages.push({ id: crypto.randomUUID(), name: file.name.slice(0, 200), dataUrl });
      } else if (EXTRACT_EXTS.includes(extOf(file.name))) {
        // 문서(PDF/Word/Excel/PPT 등) → base64 원본 전송, 백엔드가 텍스트 추출
        if (nextFiles.length >= MAX_FILES) continue;
        const data = await readFileBase64(file);
        if (!data) continue;
        nextFiles.push({
          id: crypto.randomUUID(),
          name: file.name.slice(0, 200),
          type: file.type || "application/octet-stream",
          data,
          size: file.size,
        });
      } else {
        if (nextFiles.length >= MAX_FILES || total >= MAX_TOTAL_CHARS) continue;
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
        nextFiles.push({
          id: crypto.randomUUID(),
          name: file.name.slice(0, 200),
          type: file.type || "text/plain",
          content,
          size: file.size,
          truncated,
        });
      }
    }
    setFiles(nextFiles);
    setImages(nextImages);
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));
  const removeImage = (id: string) => setImages((prev) => prev.filter((i) => i.id !== id));

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
    imageMode,
    artifactMode,
    structuredMode,
    selectedModel,
    style,
    inputDraft,
    toggle,
    setSelectedModel,
    cycleStyle,
    setInputDraft,
  } = useAppStore();

  // ── 슬래시(/) 스킬 호출 드롭다운 ──
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const slashMatch = SLASH_PATTERN.exec(text);
  // 후보 조건: "/토큰" 패턴 + Esc/외부클릭으로 닫지 않음 + 생성중 아님
  const slashCandidate = !!slashMatch && !slashDismissed && !isGenerating;
  const slashQuery = slashMatch?.[1] ?? "";
  // 디바운스된 검색어 (입력 폭주 시 과도한 요청 방지)
  const [slashDebounced, setSlashDebounced] = useState("");
  useEffect(() => {
    if (!slashCandidate) return;
    const timer = setTimeout(() => setSlashDebounced(slashQuery), 150);
    return () => clearTimeout(timer);
  }, [slashQuery, slashCandidate]);

  const { data: slashSkillsData, isLoading: slashLoading } = useQuery({
    queryKey: ["skills", slashDebounced],
    queryFn: () => fetchSkills(slashDebounced),
    enabled: slashCandidate,
    staleTime: 30_000,
  });
  // 검색어 없으면("/") 카테고리 그룹핑(전체), 있으면 평면 검색 목록
  const slashGrouped = slashDebounced.trim() === "";
  const rawSlashSkills: SkillSummary[] = slashCandidate ? slashSkillsData ?? [] : [];
  const slashSkills: SkillSummary[] = slashGrouped
    ? groupSkillsByCategory(rawSlashSkills)
    : rawSlashSkills;
  // 메뉴 표시: 후보 상태이며 로딩 중이거나 결과가 있을 때
  const slashMenuOpen = slashCandidate && (slashLoading || slashSkills.length > 0);
  // 키보드 순회 길이: 스킬 + "전체 보기" 1
  const slashNavCount = slashSkills.length + 1;
  const slashViewAllIndex = slashSkills.length;

  // 검색 결과가 바뀌면 활성 인덱스 초기화
  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashDebounced, slashSkillsData]);

  // "전체 보기" → 스킬 라이브러리로 이동하고 메뉴 닫기
  const goToSkillLibrary = () => {
    setSlashDismissed(true);
    router.push("/skill-library");
  };

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!slashMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setSlashDismissed(true);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [slashMenuOpen]);

  // 스킬 선택 → 텍스트를 "/<slug> " 로 채우고 포커스 유지 (이후 메시지 이어쓰기)
  const selectSlashSkill = (skill: SkillSummary) => {
    setText(`/${skillSlug(skill.name)} `);
    setSlashActiveIndex(0);
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  };

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
    if ((!text.trim() && files.length === 0 && images.length === 0) || isGenerating) return;
    if (agentTaskMode) {
      // 에이전트 토글 ON — 메시지를 목표로 자율 에이전트 작업 실행 (REST). 첨부는 미지원.
      void startAgentTask(text.trim());
    } else if (structuredMode) {
      // 구조화 답변 토글 ON — REST /api/chat/structured (비스트리밍, 카드 렌더). 첨부는 미지원.
      void sendStructured(text.trim());
    } else {
      sendChat(
        text.trim(),
        images.length ? images.map((i) => i.dataUrl) : undefined,
        files.length ? files : undefined,
      );
    }
    setText("");
    setFiles([]);
    setImages([]);
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

  // 모드 시트: Escape 로 닫기
  useEffect(() => {
    if (!modeSheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModeSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modeSheetOpen]);

  const TOGGLES = [
    { key: "discussionMode" as const, on: discussionMode, icon: MessagesSquare, label: t("toggle.discussion") },
    { key: "thinkingEnabled" as const, on: thinkingEnabled, icon: Brain, label: t("toggle.thinking") },
    { key: "deepResearchMode" as const, on: deepResearchMode, icon: Telescope, label: t("toggle.deepResearch") },
    { key: "webSearchEnabled" as const, on: webSearchEnabled, icon: Globe, label: t("toggle.web") },
    { key: "agentTaskMode" as const, on: agentTaskMode, icon: Sparkles, label: t("toggle.agent") },
    { key: "imageMode" as const, on: imageMode, icon: ImageIcon, label: t("toggle.image") },
    { key: "artifactMode" as const, on: artifactMode, icon: FileCode2, label: t("toggle.artifact") },
    { key: "structuredMode" as const, on: structuredMode, icon: LayoutList, label: t("toggle.structured") },
  ];
  const activeModeCount = TOGGLES.filter((m) => m.on).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div
        ref={rootRef}
        className={cn(
          "relative rounded-xl border bg-surface shadow-2 transition-colors",
          dragging ? "border-accent ring-2 ring-accent/40" : "border-border",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          // 자식으로의 dragleave 무시 — 컴포저 경계를 실제로 벗어날 때만 해제
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-surface/85 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-accent">
              <Paperclip className="h-4 w-4" />
              {t("dropToAttach")}
            </div>
          </div>
        )}
        {/* 모드 시트 — 컴포저 위로 떠오르는 바텀시트(모바일 최적화). 7개 모드를 세로 리스트로
            수납해 바가 가로 스크롤/넘침 없이 동작한다. (OD openmake-mobile '+' 시트 패턴) */}
        {modeSheetOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setModeSheetOpen(false)}
              aria-hidden
            />
            <div className="absolute bottom-full left-0 right-0 z-40 mb-2 rounded-xl border border-border bg-surface-2 p-1.5 shadow-lg">
              <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-border-strong" aria-hidden />
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-faint">
                {t("modeHeading")}
              </p>
              {TOGGLES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggle(m.key)}
                  className={cn(
                    "flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-sm transition",
                    m.on ? "text-accent" : "text-fg-2 hover:bg-surface-3",
                  )}
                >
                  <m.icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1 text-left">{m.label}</span>
                  {m.on && <Check className="h-4 w-4 shrink-0 text-accent" />}
                </button>
              ))}
            </div>
          </>
        )}

        {/* 모드 트리거 '도구' + 활성 모드 칩(flex-wrap) — 가로 스크롤 없음 */}
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
          <button
            type="button"
            onClick={() => setModeSheetOpen((v) => !v)}
            aria-expanded={modeSheetOpen}
            aria-label={t("modeSelect")}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
              activeModeCount > 0
                ? "border-accent bg-accent-soft text-accent"
                : "border-border text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t("toolsButton")}
            {activeModeCount > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-fg">
                {activeModeCount}
              </span>
            )}
          </button>

          {TOGGLES.filter((m) => m.on).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => toggle(m.key)}
              title={t("toggleOff", { label: m.label })}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent transition hover:opacity-80"
            >
              <m.icon className="h-3.5 w-3.5" />
              {m.label}
              <X className="h-3 w-3 opacity-70" />
            </button>
          ))}
        </div>

        {/* 첨부 칩 — 이미지 썸네일 + 텍스트/파일 칩 */}
        {(files.length > 0 || images.length > 0) && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2">
            {images.map((img) => (
              <span
                key={img.id}
                title={img.name}
                className="relative inline-flex h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-surface-2"
              >
                {/* data URL 미리보기 — next/image 비대상(로컬 base64). eslint-disable 의도적. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
                <button
                  onClick={() => removeImage(img.id)}
                  aria-label={t("removeAttachment", { name: img.name })}
                  className="absolute right-0 top-0 grid h-4 w-4 place-items-center rounded-bl bg-bg/70 text-muted hover:text-fg"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {files.map((f) => (
              <span
                key={f.id}
                title={f.truncated ? t("attachTruncated", { name: f.name }) : f.name}
                className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-fg"
              >
                <Paperclip className="h-3 w-3 shrink-0 text-muted" />
                <span className="truncate">{f.name}</span>
                {f.truncated && <span className="shrink-0 text-faint">✂</span>}
                <button
                  onClick={() => removeFile(f.id)}
                  aria-label={t("removeAttachment", { name: f.name })}
                  className="shrink-0 text-muted hover:text-fg"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {slashMenuOpen && (
          <SlashSkillMenu
            skills={slashSkills}
            grouped={slashGrouped}
            activeIndex={slashActiveIndex}
            loading={slashLoading}
            onSelect={selectSlashSkill}
            onHover={setSlashActiveIndex}
            onViewAll={goToSkillLibrary}
          />
        )}

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // 사용자가 다시 입력하면 Esc/외부클릭으로 닫았던 메뉴 후보를 재활성화
            if (slashDismissed) setSlashDismissed(false);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
          }}
          onKeyDown={(e) => {
            // 슬래시 메뉴가 열려 있으면 네비게이션/선택 우선 처리.
            // 활성 인덱스는 스킬(0..n-1) + "전체 보기"(n) 를 순회.
            if (slashMenuOpen) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashActiveIndex((i) => (i + 1) % slashNavCount);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashActiveIndex((i) => (i - 1 + slashNavCount) % slashNavCount);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlashDismissed(true);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                // "전체 보기" 활성 → 라이브러리 이동
                if (slashActiveIndex === slashViewAllIndex) {
                  e.preventDefault();
                  goToSkillLibrary();
                  return;
                }
                // 스킬 항목 활성 → 선택. 없으면 아래 submit 으로 fall-through
                const sel = slashSkills[slashActiveIndex];
                if (sel) {
                  e.preventDefault();
                  selectSlashSkill(sel);
                  return;
                }
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={t("placeholder")}
          className="block w-full resize-none bg-transparent px-4 pt-2.5 text-sm text-fg outline-none placeholder:text-muted"
        />

        {/* 하단: 스타일 + 전송 (모델 선택은 설정 → 기본 모델에서, 채팅창엔 모델명 비표시) */}
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1">
          {/* 파일 첨부 */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = ""; // 같은 파일 재선택 허용
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="grid h-8 w-8 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            title={t("attachFile")}
            aria-label={t("attachFileLabel")}
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <button
            onClick={cycleStyle}
            className="rounded-md px-2 py-1.5 text-xs font-medium capitalize text-muted hover:bg-surface-2 hover:text-fg"
            title={t("responseStyle")}
          >
            {style}
          </button>

          {isGenerating ? (
            <button
              onClick={abort}
              aria-label={t("stop")}
              className="ml-auto grid h-8 w-8 place-items-center rounded-md bg-surface-3 text-fg transition hover:bg-border-strong"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim() && files.length === 0 && images.length === 0}
              aria-label={t("send")}
              className="ml-auto grid h-8 w-8 place-items-center rounded-md bg-accent text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-faint">
        {t("disclaimer")}
      </p>
    </div>
  );
}
