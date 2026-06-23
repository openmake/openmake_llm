/*
 * Artifact Viewer bootstrap — 데이터 아일랜드(#__av_data) 를 읽어 종류별로 렌더.
 * 뷰어 오리진에 self-host (script-src 'self') → 외부요청 0. 인라인 실행 스크립트 0.
 *
 * 지원 종류: svg | mermaid | chart | react | markdown | csv | code
 * (html 종류는 이 파일을 쓰지 않음 — 아티팩트 문서 자체가 페이지)
 */
(function () {
  "use strict";
  var root = document.getElementById("__av_root");
  var dataEl = document.getElementById("__av_data");
  if (!root || !dataEl) return;

  var data;
  try { data = JSON.parse(dataEl.textContent || "{}"); }
  catch (e) { return fail("데이터 파싱 실패: " + e.message); }

  var kind = data.kind || "code";
  var content = data.content || "";

  function fail(msg) {
    var pre = document.createElement("pre");
    pre.style.cssText = "color:#b91c1c;white-space:pre-wrap;padding:12px;background:#fef2f2;border-radius:8px";
    pre.textContent = "렌더 오류: " + msg;
    root.appendChild(pre);
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  // 동적 <script src="/vendor/..."> 로드 — script-src 'self' 라 허용됨.
  function load(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error("로드 실패: " + src)); };
      document.head.appendChild(s);
    });
  }

  try {
    switch (kind) {
      case "svg": {
        var box = document.createElement("div");
        box.style.cssText = "display:grid;place-items:center";
        box.innerHTML = content; // SVG 마크업 (스크립트 아님)
        root.appendChild(box);
        break;
      }
      case "code": {
        var pre = document.createElement("pre");
        pre.style.cssText = "overflow:auto;padding:14px;background:#0f172a;color:#e2e8f0;border-radius:8px;font:13px/1.5 ui-monospace,Menlo,monospace";
        pre.innerHTML = "<code>" + esc(content) + "</code>";
        root.appendChild(pre);
        break;
      }
      case "csv": {
        root.appendChild(renderCsv(content));
        break;
      }
      case "markdown": {
        load("/vendor/marked.min.js").then(function () {
          var div = document.createElement("div");
          div.className = "av-md";
          /* global marked */
          div.innerHTML = (window.marked && (marked.parse ? marked.parse(content) : marked(content))) || esc(content);
          root.appendChild(div);
        }).catch(function (e) { fail(e.message); });
        break;
      }
      case "mermaid": {
        var pre2 = document.createElement("pre");
        pre2.className = "mermaid";
        pre2.textContent = content;
        root.appendChild(pre2);
        load("/vendor/mermaid.min.js").then(function () {
          /* global mermaid */
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
          return mermaid.run({ nodes: [pre2] });
        }).catch(function (e) { fail(e.message); });
        break;
      }
      case "chart": {
        var canvas = document.createElement("canvas");
        root.appendChild(canvas);
        load("/vendor/chart.umd.min.js").then(function () {
          /* global Chart */
          new Chart(canvas, JSON.parse(content));
        }).catch(function (e) { fail("차트: " + e.message); });
        break;
      }
      case "react": {
        var mount = document.createElement("div");
        root.appendChild(mount);
        Promise.all([
          load("/vendor/react.production.min.js"),
          load("/vendor/react-dom.production.min.js"),
        ]).then(function () {
          return load("/vendor/babel.min.js");
        }).then(function () {
          /* global Babel, React, ReactDOM */
          // 브라우저 단일파일 — ES import 불가. ① 사용자 import 제거 ② 훅을 전역 React 에서 별칭
          // ③ classic JSX runtime(React.createElement) 강제 — automatic 은 jsx-runtime import 를 삽입해 깨짐.
          var src = content.replace(/export\s+default\s+/g, "");
          src = src.replace(/^[ \t]*import\s+[^\n;]+;?[ \t]*$/gm, "");
          var prelude = "const {useState,useEffect,useRef,useMemo,useCallback,useContext,useReducer,useLayoutEffect,Fragment,createElement}=React;\n";
          var out = Babel.transform(prelude + src, {
            presets: [["react", { runtime: "classic" }], "typescript"],
            filename: "artifact.tsx",
          }).code;
          // App 컴포넌트를 정의/반환 (react 종류만 meta CSP 에 'unsafe-eval' 부여)
          var factory = new Function("React", "ReactDOM", out + "\n;return typeof App!=='undefined'?App:null;");
          var App = factory(React, ReactDOM);
          if (!App) return fail("react: App 컴포넌트를 찾을 수 없음 (export default function App 필요)");
          ReactDOM.createRoot(mount).render(React.createElement(App));
        }).catch(function (e) { fail("react: " + e.message); });
        break;
      }
      default:
        fail("미지원 종류: " + kind);
    }
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }

  function renderCsv(text) {
    var rows = text.trim().split(/\r?\n/).map(function (line) {
      return line.split(",").map(function (c) { return c.trim(); });
    });
    var table = document.createElement("table");
    table.style.cssText = "border-collapse:collapse;font-size:13px";
    rows.forEach(function (cells, i) {
      var tr = document.createElement("tr");
      cells.forEach(function (c) {
        var cell = document.createElement(i === 0 ? "th" : "td");
        cell.textContent = c;
        cell.style.cssText = "border:1px solid #cbd5e1;padding:5px 9px;text-align:left" + (i === 0 ? ";background:#f1f5f9;font-weight:600" : "");
        tr.appendChild(cell);
      });
      table.appendChild(tr);
    });
    return table;
  }
})();
