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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName(opts.title)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
