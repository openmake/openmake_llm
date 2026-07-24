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
  Scissors,
  X,
  Lock,
  BookOpen,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AttachedFileUI } from "@/lib/use-chat-socket";
import { useAppStore, INTERCEPT_MODE_KEYS } from "@/lib/store";
import { NotebookPicker } from "./notebook-picker";
import { useChatSocket } from "@/lib/use-chat-socket";
import { fetchModels } from "@/lib/models-api";
import { ApiClient } from "@/lib/api-client";
import {
  fetchSkills,
  groupSkillsByCategory,
  skillSlug,
  type SkillSummary,
} from "@/lib/skills-api";
import { SlashSkillMenu } from "@/components/chat/slash-skill-menu";
import { cn } from "@/lib/utils";
import { detectFileTaskIntent } from "@/lib/file-task-intent";

// 슬래시 스킬 호출: "/" + 공백없는 단일 토큰일 때만 드롭다운 표시.
const SLASH_PATTERN = /^\/(\S*)$/;

// 클라이언트 첨부 캡 — 백엔드 FILE_ATTACH_LIMITS 기본값과 일치(서버가 재절단하므로 advisory).
const MAX_FILES = 50;
const MAX_IMAGES = 20;
const MAX_CHARS_PER_FILE = 2_000_000;
const MAX_TOTAL_CHARS = 10_000_000;
// base64 인라인(채팅 WS 경로 호환) 상한 — 백엔드 DOC_EXTRACT MAX_BYTES_PER_FILE 기본값과 일치.
// 초과 문서는 rawFile 만 유지 → 에이전트 작업 생성 시 multipart 로 원본 스트리밍(크기 무관).
const MAX_INLINE_DOC_BYTES = 30 * 1024 * 1024;
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
  const tSettings = useTranslations("settings");
  const { sendChat, abort, startAgentTask, sendStructured } = useChatSocket();
  const router = useRouter();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<AttachedFileUI[]>([]);
  // 이미지 첨부 — base64 data URL 로 vision 채널 전송. 미리보기/제거를 위해 메타와 함께 보관.
  const [images, setImages] = useState<{ id: string; name: string; dataUrl: string }[]>([]);
  // 드래그앤드롭 오버레이 표시 상태
  const [dragging, setDragging] = useState(false);
  // 모드 시트(모바일 최적화) — 7개 토글을 가로스크롤 칩 대신 '도구' 버튼 + 시트로 수납
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  // NotebookLM 노트북 컨텍스트 — 선택 시 백엔드가 메시지 앞에 grounding 프리픽스 주입,
  // 해제 전까지 같은 대화 내에서 유지. 상태는 store(notebookContext) — 대화 전환/새 대화
  // 리셋은 clearChat·대화 로드 지점(sidebar/history)이 담당해 다른 대화로 누수되지 않는다.
  const notebook = useAppStore((s) => s.notebookContext);
  const setNotebook = useAppStore((s) => s.setNotebookContext);
  const [notebookPickerOpen, setNotebookPickerOpen] = useState(false);
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
        // 문서(PDF/Word/Excel/PPT 등) — File 원본을 유지해 에이전트 작업은 multipart 로
        // 스트리밍 전송. 추출 상한 이하만 base64 를 병행(채팅 WS 경로에서 백엔드 텍스트 추출용).
        if (nextFiles.length >= MAX_FILES) continue;
        const data = file.size <= MAX_INLINE_DOC_BYTES ? await readFileBase64(file) : undefined;
        nextFiles.push({
          id: crypto.randomUUID(),
          name: file.name.slice(0, 200),
          type: file.type || "application/octet-stream",
          ...(data ? { data } : {}),
          size: file.size,
          rawFile: file,
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
    queryFn: () => fetchModels({ usableOnly: true }),
    staleTime: 60_000,
  });
  const {
    isGenerating,
    thinkingEnabled,
    discussionMode,
    deepResearchMode,
    webSearchEnabled,
    agentTaskMode,
    agentApprovalMode,
    agentRepoUrl,
    imageMode,
    artifactMode,
    structuredMode,
    selectedModel,
    style,
    inputDraft,
    toggle,
    setSelectedModel,
    setAgentApprovalMode,
    setAgentRepoUrl,
    cycleStyle,
    setInputDraft,
    auth,
  } = useAppStore();
  // 게스트(비로그인)는 기본 모델만 사용 가능 — 외부 provider(Ollama/OpenRouter)는 가입 이용자 전용.
  const isGuest = !auth.currentUser;

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
  // Phase 2 Git: 에이전트 모드 시 사용자의 GitHub repo 목록(push 권한) 조회 → repo 입력 자동완성.
  const { data: repoData } = useQuery({
    queryKey: ["github-repos"],
    queryFn: () => ApiClient.get<{ data: { repos: Array<{ fullName: string; url: string }> } }>("/api/agent-tasks/github/repos"),
    enabled: agentTaskMode,
    staleTime: 300_000,
  });
  const repoSuggestions = repoData?.data?.repos ?? [];
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

  // 모델 목록 로드 시 현재 selectedModel 이 목록에 없으면 defaultModel 로 동기화.
  // 'default'(자동) 는 유효한 센티널 — 백엔드 ws-chat-handler 가 자동 선택으로 처리하므로
  // 구체 모델로 강제 치환하지 않는다 (치환 시 설정의 "자동" 선택이 조용히 풀리는 버그).
  useEffect(() => {
    if (!modelsData) return;
    if (selectedModel !== "default" && !modelsData.models.some((m) => m.modelId === selectedModel)) {
      setSelectedModel(modelsData.defaultModel);
    }
    // selectedModel 변동마다 재실행 불필요 — 목록 로드 시점에만 보정
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsData]);

  const submit = () => {
    if ((!text.trim() && files.length === 0 && images.length === 0) || isGenerating) return;
    if (agentTaskMode) {
      // 에이전트 토글 ON — 메시지를 목표로 자율 에이전트 작업 실행 (REST).
      // 파일 첨부는 작업 workspace 로, 이미지는 vision 채널로 전달.
      void startAgentTask(
        text.trim(),
        files.length ? files : undefined,
        images.length ? images.map((i) => i.dataUrl) : undefined,
        agentApprovalMode,
        agentRepoUrl.trim() || undefined,
      );
    } else if (structuredMode) {
      // 구조화 답변 토글 ON — REST /api/chat/structured (비스트리밍, 카드 렌더). 첨부는 미지원.
      void sendStructured(text.trim());
    } else if (
      !discussionMode && !deepResearchMode && !imageMode &&
      files.length > 0 && detectFileTaskIntent(text)
    ) {
      // 자동 위임(Option B) — 파일 첨부 + 가공/편집/생성/정밀분석 의도면, 스트리밍 채팅 대신
      // 에이전트 작업으로 매끄럽게 위임한다. 샌드박스가 원본 파일을 python
      // (openpyxl/python-docx/reportlab 등)으로 처리 → 진행·결과·생성파일 다운로드는
      // 인라인 AgentTaskCard 가 그대로 렌더(별도 모드 전환 없음). 순수 읽기/요약은 채팅 유지.
      // 승인정책: 자동 위임은 매끄러움 우선으로 high-risk(파일 읽기/쓰기는 자동, bash/python/
      // 파일삭제만 1회 승인). 사용자가 Skip(none, 전부 자동)을 골랐다면 그 의도를 존중.
      const delegationApproval = agentApprovalMode === "none" ? "none" : "high-risk";
      void startAgentTask(
        text.trim(),
        files,
        images.length ? images.map((i) => i.dataUrl) : undefined,
        delegationApproval,
        undefined,
      );
    } else {
      // NotebookLM 컨텍스트 — grounding 프리픽스는 백엔드(prompts/notebook-context)가 주입.
      // 가로채기 모드(토론/딥리서치/이미지)는 도구를 우회하므로 미전송 — 칩은 흐림 표시로 안내.
      const nbApplies = !discussionMode && !deepResearchMode && !imageMode;
      sendChat(
        text.trim(),
        images.length ? images.map((i) => i.dataUrl) : undefined,
        files.length ? files : undefined,
        nbApplies ? notebook : null,
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

  // 승인 3모드 세그먼트 — all=Manual, high-risk=Auto, none=Skip (에이전트 작업 위임 시 노출).
  const APPROVAL_MODES = [
    { v: "all" as const, label: t("approvalMode.manual"), hint: t("approvalMode.manualHint") },
    { v: "high-risk" as const, label: t("approvalMode.auto"), hint: t("approvalMode.autoHint") },
    { v: "none" as const, label: t("approvalMode.skip"), hint: t("approvalMode.skipHint") },
  ];

  // 가로채기(bypass) 모드: 켜지면 백엔드가 웹·아티팩트 modifier 를 무시(전용 파이프라인).
  const INTERCEPT_KEYS = new Set<string>(INTERCEPT_MODE_KEYS);
  const MODIFIER_KEYS = new Set<string>(["webSearchEnabled", "artifactMode"]);
  const interceptActive = TOGGLES.some((m) => m.on && INTERCEPT_KEYS.has(m.key));

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
              {TOGGLES.map((m) => {
                const isIntercept = INTERCEPT_KEYS.has(m.key);
                // 가로채기 모드가 켜져 있으면 웹·아티팩트 modifier 는 무시되므로 흐리게 + "(미적용)".
                const suppressed = interceptActive && MODIFIER_KEYS.has(m.key);
                const onColor = isIntercept ? "text-warn" : "text-accent";
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggle(m.key)}
                    title={suppressed ? t("modifierSuppressed", { label: m.label }) : undefined}
                    className={cn(
                      "flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-sm transition",
                      m.on ? onColor : suppressed ? "text-faint" : "text-fg-2 hover:bg-surface-3",
                    )}
                  >
                    <m.icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="flex-1 text-left">
                      {m.label}
                      {suppressed && (
                        <span className="ml-1.5 text-[11px] text-faint">{t("suppressedTag")}</span>
                      )}
                    </span>
                    {m.on && <Check className={cn("h-4 w-4 shrink-0", onColor)} />}
                  </button>
                );
              })}
              {/* 노트북 선택 — 토글이 아닌 컨텍스트 선택기(2단): 시트를 닫고 picker 팝오버를 연다.
                  선택된 노트북은 툴바의 컨텍스트 칩으로 표시·해제. */}
              <div className="mx-2 my-1 border-t border-border" aria-hidden />
              <button
                type="button"
                onClick={() => {
                  setModeSheetOpen(false);
                  setNotebookPickerOpen(true);
                }}
                className={cn(
                  "flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-sm transition",
                  notebook ? "text-accent" : "text-fg-2 hover:bg-surface-3",
                )}
              >
                <BookOpen className="h-[18px] w-[18px] shrink-0" />
                <span className="flex-1 truncate text-left">
                  {t("notebooks.select")}
                  {notebook && (
                    <span className="ml-1.5 text-[11px] text-faint">{notebook.title}</span>
                  )}
                </span>
                {notebook && <Check className="h-4 w-4 shrink-0 text-accent" />}
              </button>
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

          <NotebookPicker
            value={notebook}
            onChange={setNotebook}
            open={notebookPickerOpen}
            onOpenChange={setNotebookPickerOpen}
            suppressed={interceptActive || agentTaskMode || structuredMode}
          />

          {TOGGLES.filter((m) => m.on).map((m) => {
            // 가로채기 모드 칩은 앰버색 — 도구·아티팩트를 무시한다는 시각 신호.
            const isIntercept = INTERCEPT_KEYS.has(m.key);
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => toggle(m.key)}
                title={t("toggleOff", { label: m.label })}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition hover:opacity-80",
                  isIntercept
                    ? "border-warn bg-warn-soft text-warn"
                    : "border-accent bg-accent-soft text-accent",
                )}
              >
                <m.icon className="h-3.5 w-3.5" />
                {m.label}
                <X className="h-3 w-3 opacity-70" />
              </button>
            );
          })}
        </div>

        {/* Phase 2 Git — repo URL 지정 시 태스크가 해당 repo 를 clone 해 작업 후 PR 생성(선택). */}
        {agentTaskMode && (
          <div className="flex items-center gap-2 px-3 pt-2 text-xs">
            <span className="shrink-0 text-muted">{t("repo.label")}</span>
            <input
              type="text"
              value={agentRepoUrl}
              onChange={(e) => setAgentRepoUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
              list="agent-repo-suggestions"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-fg-1"
            />
            {repoSuggestions.length > 0 && (
              <datalist id="agent-repo-suggestions">
                {repoSuggestions.map((r) => (
                  <option key={r.url} value={r.url}>{r.fullName}</option>
                ))}
              </datalist>
            )}
          </div>
        )}
        {/* 승인 3모드(Manual/Auto/Skip) — 에이전트 작업 위임 시 이 실행의 도구 승인 정책 선택. */}
        {agentTaskMode && (
          <div className="flex items-center gap-2 px-3 pt-2 text-xs">
            <span className="text-muted">{t("approvalMode.label")}</span>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {APPROVAL_MODES.map((m) => (
                <button
                  key={m.v}
                  type="button"
                  onClick={() => setAgentApprovalMode(m.v)}
                  title={m.hint}
                  className={cn(
                    "px-2 py-0.5 font-medium transition",
                    agentApprovalMode === m.v
                      ? "bg-accent text-accent-fg"
                      : "text-muted hover:bg-surface-2",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

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
                {f.truncated && <Scissors className="h-3 w-3 shrink-0 text-faint" aria-label={t("attachTruncated", { name: f.name })} />}
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

        {/* 하단: 첨부 + 스타일 + 모델 칩 + 전송 */}
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
            className="rounded-md px-2 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg"
            title={t("responseStyle")}
          >
            {tSettings(`responseStyles.${style}`)}
          </button>

          {/* 사용 중인 LLM 모델 — 표시 전용 (변경은 설정 → 모델&응답 → 기본 모델).
              '자동' 이면 서버 기본모델명을 병기해 실제 사용 모델을 노출한다.
              게스트는 기본 모델만 사용 가능 → 잠금 아이콘 + 고지 tooltip. */}
          {isGuest && <Lock className="h-3 w-3 shrink-0 text-faint" aria-hidden />}
          <span
            className="max-w-[200px] truncate px-2 py-1.5 text-xs font-medium text-muted"
            title={
              isGuest
                ? tSettings("guestModelNotice")
                : selectedModel === "default" || !selectedModel
                  ? (modelsData?.defaultModel ?? t("modelAuto"))
                  : selectedModel
            }
            aria-label={t("modelLabel")}
          >
            {(() => {
              const nameOf = (fullId: string) =>
                modelsData?.models.find((m) => m.modelId === fullId)?.name ??
                fullId.split(":").slice(1).join(":");
              if (selectedModel === "default" || !selectedModel) {
                return modelsData?.defaultModel
                  ? `${t("modelAuto")} · ${nameOf(modelsData.defaultModel)}`
                  : t("modelAuto");
              }
              return nameOf(selectedModel);
            })()}
          </span>

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
      {isGuest && (
        <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted">
          <Lock className="h-3 w-3 shrink-0" aria-hidden />
          {tSettings("guestModelNotice")}
        </p>
      )}
      <p className="mt-2 text-center text-[11px] text-faint">
        {t("disclaimer")}
      </p>
    </div>
  );
}
