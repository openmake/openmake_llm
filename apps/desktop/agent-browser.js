// Local Agent Browser (Cowork D3) — 서버 Agent Task 의 `browser` 도구를
// **데스크톱 Electron 내장 Chromium** 에서 실행한다. Playwright 를 번들하지 않으므로
// 앱 크기 증가가 없고, 사용자가 화면으로 보면서 언제든 중단할 수 있다.
//
// 출력 계약은 컨테이너 경로(infra/task-runtime/browser-runner.mjs)와 **동일**하게 맞춘다:
//   { ok, finalUrl, results: [{ i, type, ok, ... }] }
// 서버측 파싱·프롬프트를 그대로 재사용하기 위함.
//
// 보안 불변식:
//  - 전용 세션 파티션(persist:openmake-agent) — 사용자 개인 Chrome 쿠키·로그인 미접근
//  - allowlist 가 있으면 비허용 호스트 요청을 webRequest 로 차단
//  - file:// 및 그 외 비 http(s) 스킴 차단 (로컬 파일 열람 방지)
//  - 항상 화면에 보이는 View — 백그라운드 은닉 실행 금지
//  - 다운로드는 연결 폴더 안으로만 저장(경로 이탈 차단)
const { WebContentsView, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const PARTITION = 'persist:openmake-agent';
const DEFAULT_TIMEOUT_MS = 60_000;
/** 멀티탭 확장 대비 — 지금은 1개만 쓰지만 자료구조는 맵으로 둔다(D3 후속). */
const tabs = new Map();
const MAX_TABS = 1;

let getWindow = () => null;
let getFolderRoot = () => null;

function configure(opts) {
  if (opts.getWindow) getWindow = opts.getWindow;
  if (opts.getFolderRoot) getFolderRoot = opts.getFolderRoot;
}

/* ── 세션 · 보안 ─────────────────────────────────────────── */

let sessionReady = false;

/** 전용 파티션 세션을 준비하고 allowlist·다운로드 정책을 건다. */
function ensureSession(allowlist) {
  const ses = session.fromPartition(PARTITION);
  // allowlist 는 호출마다 바뀔 수 있으므로 핸들러를 매번 다시 건다(중복 등록 방지 위해 null 로 해제 후 설정).
  ses.webRequest.onBeforeRequest(null);
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    let u;
    try { u = new URL(details.url); } catch { return cb({ cancel: true }); }
    // http(s) 외 스킴 전면 차단 — file:// 로 로컬 파일을 읽는 경로를 막는다.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return cb({ cancel: true });
    if (!hostAllowed(u.hostname, allowlist)) return cb({ cancel: true });
    cb({ cancel: false });
  });

  if (!sessionReady) {
    // 다운로드: 연결 폴더 안으로만. 폴더 미연결이면 취소.
    ses.on('will-download', (_event, item) => {
      const root = getFolderRoot();
      if (!root) { item.cancel(); return; }
      const name = path.basename(item.getFilename() || 'download');
      const dest = path.join(root, name);
      // 경로 이탈 방어 — basename 을 썼어도 realpath 기준으로 한 번 더 확인.
      const rootReal = fs.realpathSync(root);
      if (!path.resolve(dest).startsWith(rootReal + path.sep) && path.resolve(dest) !== rootReal) {
        item.cancel(); return;
      }
      item.setSavePath(dest);
    });
    // 새 창 요청은 외부 브라우저로 넘기지 않고 무시(에이전트가 goto 로만 이동).
    sessionReady = true;
  }
  return ses;
}

function hostAllowed(hostname, allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
  const h = String(hostname || '').toLowerCase();
  return allowlist.some((d) => {
    const dd = String(d).toLowerCase();
    return h === dd || h.endsWith('.' + dd);
  });
}

/* ── 탭 생명주기 ─────────────────────────────────────────── */

function ensureTab(allowlist) {
  const win = getWindow();
  if (!win) throw new Error('데스크톱 창이 없습니다');
  const ses = ensureSession(allowlist);

  let tab = tabs.get('default');
  if (tab && !tab.view.webContents.isDestroyed()) return tab;

  const view = new WebContentsView({
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.contentView.addChildView(view);
  layout(view);
  win.on('resize', () => layout(view));
  tab = { view };
  tabs.set('default', tab);
  return tab;
}

/** 창 하단 60% 를 브라우저 패널로 — 사용자가 진행 상황을 본다. */
function layout(view) {
  const win = getWindow();
  if (!win || view.webContents.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const top = Math.round(h * 0.4);
  view.setBounds({ x: 0, y: top, width: w, height: h - top });
}

function closeAll() {
  const win = getWindow();
  for (const [, tab] of tabs) {
    try {
      if (win) win.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    } catch { /* 이미 파기됨 */ }
  }
  tabs.clear();
}

/* ── 페이지 내 실행 스크립트 ──────────────────────────────
 * Playwright 의 getByRole/ariaSnapshot 에 대응하는 API 가 Electron 에 없으므로
 * DOM 을 직접 순회해 {role,name} 을 산출한다(D3c). 완전한 접근성 트리는 아니지만
 * 상호작용 요소 식별에는 충분하다 — 목적이 "CSS 셀렉터가 깨졌을 때의 폴백" 이기 때문.
 */
const A11Y_LIB = `
(() => {
  const ROLE_BY_TAG = { a:'link', button:'button', select:'combobox', textarea:'textbox', summary:'button' };
  const INPUT_ROLE = { checkbox:'checkbox', radio:'radio', button:'button', submit:'button',
                       reset:'button', search:'searchbox', email:'textbox', tel:'textbox',
                       text:'textbox', password:'textbox', url:'textbox', number:'spinbutton' };
  function roleOf(el) {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit.trim().split(/\\s+/)[0];
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') return INPUT_ROLE[(el.type || 'text').toLowerCase()] || 'textbox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return ROLE_BY_TAG[tag] || null;
  }
  function nameOf(el) {
    const byLabel = el.getAttribute && el.getAttribute('aria-label');
    if (byLabel) return byLabel.trim();
    const ref = el.getAttribute && el.getAttribute('aria-labelledby');
    if (ref) { const t = document.getElementById(ref); if (t) return (t.innerText || '').trim(); }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.labels && el.labels[0]) return (el.labels[0].innerText || '').trim();
      return (el.placeholder || el.getAttribute('title') || el.value || '').trim();
    }
    if (el.tagName === 'IMG') return (el.alt || '').trim();
    return ((el.innerText || el.textContent || '').trim()).slice(0, 120);
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }
  window.__omkCollect = function () {
    const sel = 'a,button,input,select,textarea,summary,[role],[onclick],[tabindex]';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      const role = roleOf(el);
      if (!role) continue;
      out.push({ role, name: nameOf(el), el });
      if (out.length >= 300) break;
    }
    window.__omkEls = out.map((o) => o.el);
    return out.map((o, i) => ({ index: i, role: o.role, name: o.name }));
  };
  window.__omkFind = function (role, name, nth) {
    const list = window.__omkCollect();
    const want = String(name || '').trim().toLowerCase();
    const hits = list.filter((e) => e.role === role &&
      (want === '' || e.name.toLowerCase() === want || e.name.toLowerCase().includes(want)));
    const hit = hits[Number(nth) || 0];
    return hit ? hit.index : -1;
  };
})();`;

/** 페이지에서 JS 실행 — 항상 A11Y_LIB 를 먼저 주입해 헬퍼를 보장한다. */
async function evalInPage(wc, expr) {
  await wc.executeJavaScript(A11Y_LIB, true);
  return wc.executeJavaScript(expr, true);
}

const jsStr = (v) => JSON.stringify(String(v ?? ''));

/** 셀렉터 등장 대기(폴링) — Playwright waitForSelector 대응. */
async function waitForSelector(wc, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await evalInPage(wc, `!!document.querySelector(${jsStr(selector)})`);
    if (found) return true;
    if (Date.now() > deadline) throw new Error(`waitFor 시간 초과: ${selector}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}

function loadUrl(wc, url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`goto 시간 초과: ${url}`)); }, timeoutMs);
    const ok = () => { cleanup(); resolve(); };
    const fail = (_e, code, desc) => { cleanup(); reject(new Error(`goto 실패(${code}): ${desc || url}`)); };
    function cleanup() {
      clearTimeout(timer);
      wc.off('did-finish-load', ok);
      wc.off('did-fail-load', fail);
    }
    wc.on('did-finish-load', ok);
    wc.on('did-fail-load', fail);
    wc.loadURL(url).catch(fail);
  });
}

/**
 * 액션 배열 실행 — 컨테이너 runner 와 동일한 결과 계약을 반환한다.
 * @param {{actions: any[], allowlist?: string[], timeoutMs?: number}} spec
 */
async function runActions(spec) {
  const actions = Array.isArray(spec?.actions) ? spec.actions : [];
  const allowlist = Array.isArray(spec?.allowlist) ? spec.allowlist : null;
  const timeout = Math.min(Number(spec?.timeoutMs) || DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const results = [];
  let finalUrl = '';

  let wc;
  try {
    wc = ensureTab(allowlist).view.webContents;
  } catch (e) {
    return { ok: false, error: e.message, results };
  }

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i] || {};
    try {
      switch (a.type) {
        case 'goto': {
          const u = new URL(String(a.url));
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('http(s) URL 만 허용됩니다');
          if (!hostAllowed(u.hostname, allowlist)) throw new Error(`허용되지 않은 호스트: ${u.hostname}`);
          await loadUrl(wc, u.toString(), timeout);
          results.push({ i, type: a.type, ok: true }); break;
        }
        case 'click': {
          const r = await evalInPage(wc, `(() => { const e=document.querySelector(${jsStr(a.selector)}); if(!e) return 'notfound'; e.click(); return 'ok'; })()`);
          if (r !== 'ok') throw new Error(`요소를 찾지 못했습니다: ${a.selector}`);
          results.push({ i, type: a.type, ok: true }); break;
        }
        case 'fill': {
          const r = await evalInPage(wc, `(() => { const e=document.querySelector(${jsStr(a.selector)}); if(!e) return 'notfound';
            e.focus(); e.value=${jsStr(a.text)};
            e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; })()`);
          if (r !== 'ok') throw new Error(`요소를 찾지 못했습니다: ${a.selector}`);
          results.push({ i, type: a.type, ok: true }); break;
        }
        case 'press': {
          const key = String(a.key || '');
          wc.sendInputEvent({ type: 'keyDown', keyCode: key });
          wc.sendInputEvent({ type: 'keyUp', keyCode: key });
          results.push({ i, type: a.type, ok: true }); break;
        }
        case 'wait':
          await new Promise((r) => setTimeout(r, Math.min(Number(a.ms) || 0, timeout)));
          results.push({ i, type: a.type, ok: true }); break;
        case 'waitFor':
          await waitForSelector(wc, String(a.selector), timeout);
          results.push({ i, type: a.type, ok: true }); break;
        case 'screenshot': {
          // ⚠️ capturePage 는 **창이 화면에 표시돼 있어야** 유효한 이미지를 준다.
          //    창이 숨겨졌거나 최소화된 상태면 빈 이미지/실패가 된다(실측 확인).
          //    에이전트 브라우저는 어차피 항상 보이는 패널이므로 정상 경로에서는 문제없다.
          const win = getWindow();
          if (win && (!win.isVisible() || win.isMinimized())) {
            throw new Error('창이 보이지 않아 스크린샷을 찍을 수 없습니다 (창을 복원한 뒤 다시 시도하세요)');
          }
          const img = await wc.capturePage();
          const root = getFolderRoot();
          if (!root) throw new Error('연결된 폴더가 없어 스크린샷을 저장할 수 없습니다');
          const rel = path.basename(String(a.path || `screenshot-${Date.now()}.png`));
          fs.writeFileSync(path.join(root, rel), img.toPNG());
          results.push({ i, type: a.type, ok: true, path: rel }); break;
        }
        case 'extractText': {
          const expr = a.selector
            ? `(() => { const e=document.querySelector(${jsStr(a.selector)}); return e ? (e.innerText||'') : null; })()`
            : `document.body ? (document.body.innerText||'') : ''`;
          const text = await evalInPage(wc, expr);
          if (text === null) throw new Error(`요소를 찾지 못했습니다: ${a.selector}`);
          results.push({ i, type: a.type, ok: true, text: String(text).slice(0, 50000) }); break;
        }
        case 'extractHtml': {
          const expr = a.selector
            ? `(() => { const e=document.querySelector(${jsStr(a.selector)}); return e ? e.outerHTML : null; })()`
            : `document.documentElement.outerHTML`;
          const html = await evalInPage(wc, expr);
          if (html === null) throw new Error(`요소를 찾지 못했습니다: ${a.selector}`);
          results.push({ i, type: a.type, ok: true, html: String(html).slice(0, 50000) }); break;
        }
        /* ── D3c: CSS 가 깨졌을 때의 role/name 폴백 ── */
        case 'snapshot': {
          const elements = await evalInPage(wc, `window.__omkCollect()`);
          results.push({ i, type: a.type, ok: true, elements: (elements || []).slice(0, 100) }); break;
        }
        case 'smartClick': {
          const idx = await evalInPage(wc, `window.__omkFind(${jsStr(a.role)}, ${jsStr(a.name)}, ${Number(a.nth) || 0})`);
          if (idx < 0) throw new Error(`role=${a.role} name=${a.name} 요소를 찾지 못했습니다`);
          await evalInPage(wc, `(() => { window.__omkCollect(); window.__omkEls[${idx}].click(); return 'ok'; })()`);
          results.push({ i, type: a.type, ok: true }); break;
        }
        case 'smartFill': {
          const idx = await evalInPage(wc, `window.__omkFind(${jsStr(a.role)}, ${jsStr(a.name)}, ${Number(a.nth) || 0})`);
          if (idx < 0) throw new Error(`role=${a.role} name=${a.name} 요소를 찾지 못했습니다`);
          await evalInPage(wc, `(() => { window.__omkCollect(); const e=window.__omkEls[${idx}];
            e.focus(); e.value=${jsStr(a.text)};
            e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; })()`);
          results.push({ i, type: a.type, ok: true }); break;
        }
        default:
          throw new Error(`지원하지 않는 액션: ${a.type}`);
      }
    } catch (e) {
      results.push({ i, type: a?.type, ok: false, error: e.message });
      break; // 컨테이너 runner 와 동일 — 실패 시 중단
    }
  }
  try { finalUrl = wc.getURL(); } catch { /* 파기됨 */ }
  return { ok: results.length > 0 && results.every((r) => r.ok), finalUrl, results };
}

module.exports = { configure, runActions, closeAll, MAX_TABS };
