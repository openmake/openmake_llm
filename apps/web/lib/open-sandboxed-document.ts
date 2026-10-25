/**
 * 작업 산출물(HTML/SVG)을 새 탭에서 안전하게 연다.
 *
 * 🔒 blob: URL 은 앱 origin 을 물려받아 산출물 속 스크립트가 CSRF 쿠키를 읽고
 *    자격 증명 포함 fetch 를 할 수 있다. 그래서 새 창에는 sandbox iframe 하나만 담은
 *    셸 문서를 쓰고, 본문은 srcdoc 으로 넣는다. allow-same-origin 은 **절대** 주지 않는다
 *    (components/chat/artifact-frame.tsx 와 같은 원칙) → iframe 은 opaque origin 이다.
 */

const SANDBOXED_MIMES = new Set(["text/html", "image/svg+xml"]);
// 텍스트 종류(blob 경로)의 URL 해제 지연 — 기존 agent-tasks 화면 값과 같다.
const BLOB_REVOKE_DELAY_MS = 60_000;

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** sandbox iframe 하나만 담은 셸 HTML. srcdoc·title 은 HTML 이스케이프한다. */
export function buildSandboxShellHtml(content: string, mime: string, title: string): string {
  void mime; // html·svg 모두 srcdoc(HTML 파서)로 렌더 — 인라인 SVG 는 HTML 안에서 그대로 그려진다.
  const safeTitle = escapeHtmlAttr(title);
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    `<title>${safeTitle}</title>` +
    "<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block;background:#fff}</style>" +
    "</head><body>" +
    `<iframe sandbox="allow-scripts allow-popups" referrerpolicy="no-referrer" title="${safeTitle}" srcdoc="${escapeHtmlAttr(content)}"></iframe>` +
    "</body></html>"
  );
}

/** HTML/SVG 는 sandbox 셸로, 그 밖의 텍스트 종류는 종전 blob 경로로 새 탭에 연다. */
export function openSandboxedDocument(content: string, mime: string, title: string): void {
  if (!SANDBOXED_MIMES.has(mime)) {
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), BLOB_REVOKE_DELAY_MS);
    return;
  }
  // 'noopener' 를 주면 window.open 이 null 을 돌려줘 셸을 쓸 수 없다 → 연 직후 opener 를 끊는다.
  const win = window.open("", "_blank");
  if (!win) return;
  win.opener = null;
  win.document.open();
  win.document.write(buildSandboxShellHtml(content, mime, title));
  win.document.close();
}
