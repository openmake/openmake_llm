/**
 * 아티팩트 kind → 렌더 전략. 브라우저에서 실행되는 종류(html/svg/mermaid/chart/react)는
 * 샌드박스 iframe srcdoc 문서를 빌드하고, 나머지(code/markdown/csv 등)는 앱 트리에서 렌더한다.
 *
 * 보안: iframe 은 sandbox="allow-scripts" (allow-same-origin 미부여) → null(opaque) origin.
 * 따라서 iframe 내부 스크립트는 앱 쿠키/localStorage/부모 DOM 에 접근할 수 없다(세션 격리).
 * 여기서 빌드하는 문서 문자열은 그 iframe 의 srcdoc 으로만 사용된다.
 */

/** 라이브러리 CDN — iframe 내부에서만 로드 (앱 번들과 분리). */
const CDN = {
  mermaid: "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js",
  chart: "https://cdn.jsdelivr.net/npm/chart.js@4",
  react: "https://unpkg.com/react@18/umd/react.production.min.js",
  reactDom: "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  babel: "https://unpkg.com/@babel/standalone/babel.min.js",
} as const;

/** iframe 으로 라이브 렌더하는 kind 집합. 그 외는 앱 트리(code/표/markdown)에서 렌더. */
const IFRAME_KINDS = new Set(["html", "svg", "mermaid", "chart", "react"]);

export function isIframeKind(kind: string): boolean {
  return IFRAME_KINDS.has(kind);
}

/** HTML 텍스트 노드 이스케이프 (mermaid 소스 등 텍스트를 안전하게 삽입). */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** </script> 조기 종료 방지 — JS/JSON 문자열을 <script> 본문에 삽입할 때. */
function escapeScript(s: string): string {
  return s.replace(/<\/script/gi, "<\\/script");
}

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const BASE_STYLE =
  "<style>html,body{margin:0;padding:0}body{font-family:system-ui,-apple-system,sans-serif;padding:12px;color:#111;background:#fff}</style>";

/** 라이브러리 doc 공통 셸. */
function doc(head: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">${VIEWPORT}${head}</head><body>${body}</body></html>`;
}

/**
 * kind 별 iframe srcdoc 문서 문자열을 만든다. isIframeKind(kind) 가 true 인 경우에만 호출.
 */
export function buildArtifactSrcDoc(kind: string, content: string): string {
  switch (kind) {
    case "html": {
      // LLM 이 전체 HTML 문서를 생성(artifact-guide). 문서면 그대로, 조각이면 셸로 감싼다.
      const looksFullDoc = /<html[\s>]|<!doctype/i.test(content);
      return looksFullDoc ? content : doc(BASE_STYLE, content);
    }
    case "svg": {
      return doc(
        BASE_STYLE + "<style>body{display:grid;place-items:center;min-height:100vh}svg{max-width:100%;height:auto}</style>",
        content,
      );
    }
    case "mermaid": {
      return doc(
        `<script src="${CDN.mermaid}"></script>${BASE_STYLE}`,
        `<pre class="mermaid">${escapeHtml(content)}</pre>` +
          `<script>mermaid.initialize({startOnLoad:true,securityLevel:'strict'});</script>`,
      );
    }
    case "chart": {
      return doc(
        `<script src="${CDN.chart}"></script>${BASE_STYLE}`,
        `<canvas id="c"></canvas><script>try{new Chart(document.getElementById('c'),${escapeScript(content)});}catch(e){document.body.innerHTML='<pre>차트 오류: '+e.message+'</pre>';}</script>`,
      );
    }
    case "react": {
      // export default 제거 → Babel(text/babel) 은 ES module export 미지원. App 정의 후 렌더.
      const code = escapeScript(content.replace(/export\s+default\s+/g, ""));
      return doc(
        `<script src="${CDN.react}"></script><script src="${CDN.reactDom}"></script><script src="${CDN.babel}"></script>${BASE_STYLE}`,
        `<div id="root"></div><script type="text/babel" data-presets="react,typescript">
${code}
try{ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));}
catch(e){document.getElementById('root').innerHTML='<pre>렌더 오류: '+e.message+'</pre>';}
</script>`,
      );
    }
    default:
      return doc(BASE_STYLE, `<pre>${escapeHtml(content)}</pre>`);
  }
}
