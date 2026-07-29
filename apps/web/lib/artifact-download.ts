/**
 * 아티팩트 본문을 종류/언어에 맞는 확장자로 파일 다운로드.
 * Claude Code Artifacts 의 "파일로 받기" 동등 — 외부 공유/보관용.
 */

const KIND_EXT: Record<string, string> = {
  html: "html",
  svg: "svg",
  markdown: "md",
  csv: "csv",
  mermaid: "mmd",
  chart: "json",
  react: "jsx",
};

const LANG_EXT: Record<string, string> = {
  python: "py",
  py: "py",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  jsx: "jsx",
  java: "java",
  go: "go",
  rust: "rs",
  ruby: "rb",
  php: "php",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  shell: "sh",
  bash: "sh",
  sql: "sql",
  json: "json",
  yaml: "yaml",
  html: "html",
  css: "css",
};

/** UUID(v4) 형태 문자열 — title 이 없어 artifact id(UUID)로 폴백된 경우 파일명으로 부적합. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeName(title: string): string {
  const t = (title || "").trim();
  // 빈 값 또는 UUID(제목 없이 id 로 폴백된 케이스)면 사람이 못 알아보는 파일명이 되므로 'artifact' 로.
  const base = !t || UUID_RE.test(t) ? "artifact" : t;
  return base.replace(/[^\w가-힣.-]+/g, "_").slice(0, 60) || "artifact";
}

function extFor(kind: string, lang: string | null): string {
  if (kind === "code" && lang) return LANG_EXT[lang.toLowerCase()] ?? "txt";
  return KIND_EXT[kind] ?? "txt";
}

export function downloadArtifact(opts: { title: string; kind: string; lang: string | null; content: string }) {
  const ext = extFor(opts.kind, opts.lang);
  const blob = new Blob([opts.content], { type: "text/plain;charset=utf-8" });
  triggerBlobDownload(blob, `${safeName(opts.title)}.${ext}`);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 서버 변환 export (P1 Phase 3) — html 아티팩트를 pdf/docx 로 변환해 다운로드.
 * pdf 는 모든 html 아티팩트, docx 는 보고서 아티팩트(reportdata 원본 보유)만 (서버 409).
 * 오류는 throw — 호출부(패널)가 상태 메시지로 표시.
 */
export async function downloadExportedArtifact(opts: {
  /** 채팅 아티팩트(artifacts 테이블)용 — taskId 미지정 시 필수 */
  sessionId?: string;
  /** Agent Task 산출물(스텝 저장분)용 — 지정 시 task 전용 엔드포인트로 라우팅 */
  taskId?: string;
  artifactId: string;
  format: "pdf" | "docx";
  title: string;
}): Promise<void> {
  const { ApiClient } = await import("./api-client");
  const url = opts.taskId
    ? `/api/agent-tasks/${encodeURIComponent(opts.taskId)}/artifacts/${encodeURIComponent(opts.artifactId)}/export`
    : `/api/sessions/${encodeURIComponent(opts.sessionId ?? "")}/artifacts/${encodeURIComponent(opts.artifactId)}/export`;
  const res = await ApiClient.post<{ data: { filename: string; mime: string; dataBase64: string } }>(
    url,
    { format: opts.format },
  );
  const d = res.data;
  const bin = atob(d.dataBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: d.mime });
  triggerBlobDownload(blob, d.filename || `${safeName(opts.title)}.${opts.format}`);
}
