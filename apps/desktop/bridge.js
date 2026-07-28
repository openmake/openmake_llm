// Local Bridge (Cowork D1b) — 로컬 실행기: 서버 Agent Task 의 도구 호출을
// 사용자가 연결한 폴더를 작업 기준으로 실행한다. 프로토콜은 서버
// apps/api/src/services/local-bridge/ (D1a) 와 1:1.
//
// 보안 불변식:
//  - 고정 kind 화이트리스트만 처리 (임의 RPC 거부)
//  - browser kind(D3): 전용 세션 파티션의 Electron 내장 Chromium. 개인 브라우저와 분리,
//    http(s) 외 스킴·비allowlist 호스트 차단, 다운로드는 연결 폴더 안으로만
//  - 파일 kind(read/write/list/delete)의 경로는 연결 폴더 realpath 스코프 안에서만
//    해석 (심링크 탈출 차단)
//  - exec 3단 방어: ① 명백히 위험한 패턴을 디바이스에서 hard-block(EXEC_DENYLIST)
//    ② 나머지는 실행 전 매번 사용자 확인(confirmExec) — 서버 승인 설정과 무관한 비우회 게이트
//    ③ 승인된 명령도 OS 샌드박스(sandbox-exec)로 감싸 폴더 밖 쓰기·비밀 읽기를 커널이 차단
//    (읽기 일반·네트워크는 허용 — 개발 명령 호환. 막는 축은 '파괴'와 '비밀 유출')
//  - 인증은 앱 세션의 auth_token 쿠키 재사용 (토큰을 디스크에 저장하지 않음)
const { session, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');
const WebSocket = require('ws');
const agentBrowser = require('./agent-browser');

const EXEC_TIMEOUT_MS = 120000;
const MAX_BUFFER = 1024 * 1024;
const RECONNECT_MS = 10000;

// ── exec OS 샌드박스 (macOS sandbox-exec) ───────────────────────────────
// 승인된 명령이라도 OS 레벨에서 ① 연결 폴더 밖 쓰기 ② 비밀 파일 읽기를 차단한다.
// 승인 게이트(사용자 확인)의 백스톱 — 오승인·프롬프트 인젝션으로 새는 피해를 제한.
// 읽기는 폭넓게 허용(개발 명령 호환), 네트워크도 허용(npm/git 필수) — 막는 축은 '파괴'와 '비밀'.
const SANDBOX_BIN = '/usr/bin/sandbox-exec';
const SANDBOX_ENABLED = process.env.OMK_BRIDGE_SANDBOX !== '0';
/** 워크스페이스 밖이지만 쓰기를 허용해야 하는 툴 캐시 — 없으면 npm/pip/cargo 계열이 깨진다. */
const CACHE_SUBPATHS = ['.npm', '.cache', 'Library/Caches', '.cargo', '.gradle', '.m2', '.yarn', '.pnpm-store', 'go/pkg'];
/** 읽기를 차단할 비밀 경로. */
const SECRET_SUBPATHS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config/gcloud', 'Library/Keychains'];
let sandboxProfilePath = null;

// exec 가드레일(보안 경계 아님, 우발·명백 유출 백스톱) — 매칭 시 확인 없이 즉시 거부.
// 난독화로 우회 가능함을 인정하되, LLM 인젝션·실수로 인한 명백한 파괴/유출을 차단한다.
const EXEC_DENYLIST = [
  { re: /(^|[;&|(]|\s)sudo\s/, why: '권한 상승(sudo)' },
  { re: /(^|[;&|(]|\s)doas\s/, why: '권한 상승(doas)' },
  { re: /(curl|wget)\s[^|]*\|\s*(sh|bash|zsh)\b/, why: '원격 스크립트 직접 실행(pipe-to-shell)' },
  { re: /\|\s*(sh|bash|zsh)\b/, why: '파이프-투-셸 실행' },
  { re: /\brm\s+-\w*\s+(\/|~|\$HOME|\$\{HOME\})(\s|$)/, why: '홈/루트 대량 삭제' },
  { re: /\.ssh(\/|\b)/, why: 'SSH 키 디렉토리 접근' },
  { re: /id_rsa|id_ed25519|\.aws\/credentials|\.config\/gcloud/, why: '자격증명 파일 접근' },
  { re: /:\s*\(\s*\)\s*\{/, why: 'fork bomb' },
  { re: /\bdd\s+if=|\bmkfs\b|>\s*\/dev\/(disk|sd|rdisk)/, why: '디스크 파괴 연산' },
];
function matchDenylist(cmd) {
  const c = String(cmd);
  for (const d of EXEC_DENYLIST) if (d.re.test(c)) return d.why;
  return null;
}
// 서버 WS 하트비트는 액세스 토큰 만료 시 연결을 terminate 한다 — 세션 쿠키에서 최신
// 토큰을 읽어 기존 refresh 프로토콜({type:'refresh'})로 주기 연장해 유휴 플랩을 막는다.
const REFRESH_MS = parseInt(process.env.OMK_BRIDGE_REFRESH_MS || '300000', 10);

let ws = null;
let folderRoot = null;       // realpath 확정된 연결 폴더 (null=미연결)
let wsUrl = null;
let reconnectTimer = null;
let refreshTimer = null;
let statusText = '미연결';
let onStatusChange = () => {};
let mainWin = null;          // exec 확인 다이얼로그의 부모 창

/** exec 실행 전 사용자 확인(비우회). 거부/취소면 false. 실행될 명령 원문을 그대로 보여준다. */
async function confirmExec(command) {
  // 테스트 훅(개발/E2E 전용): 다이얼로그 없이 자동 승인 (다른 OMK_BRIDGE_* 훅과 동일 계열).
  if (process.env.OMK_BRIDGE_AUTO_APPROVE === '1') return true;
  const preview = command.length > 800 ? command.slice(0, 800) + '…' : command;
  const r = await dialog.showMessageBox(mainWin || undefined, {
    type: 'warning',
    message: '에이전트가 이 셸 명령을 당신의 컴퓨터에서 실행하려고 합니다',
    detail: `${preview}\n\n연결 폴더: ${folderRoot}\n${SANDBOX_ENABLED && sandboxProfilePath
      ? 'OS 샌드박스 적용: 폴더 밖 쓰기와 비밀 파일(.ssh/.aws 등) 읽기는 차단됩니다. 그 외 읽기·네트워크는 허용됩니다.'
      : '⚠️ 샌드박스 미적용: 이 명령은 당신 계정 권한으로 폴더 밖 파일·네트워크에 접근할 수 있습니다.'}`,
    buttons: ['실행', '거부'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return r.response === 0;
}

function deviceId(app) {
  const p = path.join(app.getPath('userData'), 'device-id');
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* 최초 생성 */ }
  const id = crypto.randomUUID();
  try { fs.writeFileSync(p, id); } catch { /* noop */ }
  return id;
}

/** SBPL 문자열 리터럴 escape. */
function sbq(p) { return `"${String(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }

/**
 * 연결 폴더 기준 sandbox-exec 프로파일을 생성해 경로를 반환한다(실패 시 null).
 * 정책: 기본 allow → 쓰기는 폴더·임시·툴캐시로 제한, 비밀 경로는 읽기 차단.
 * (SBPL 은 last-match-wins 이라 deny 뒤에 allow 를 두어야 예외가 성립한다.)
 */
function writeSandboxProfile(app, root) {
    try {
        const home = fs.realpathSync(os.homedir());
        const sub = (base, list) => list.map((d) => `(subpath ${sbq(path.join(base, d))})`).join(' ');
        const profile = [
            '(version 1)',
            '(allow default)',
            '(deny file-write*)',
            `(allow file-write* (subpath ${sbq(root)}))`,
            '(allow file-write* (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/dev"))',
            `(allow file-write* ${sub(home, CACHE_SUBPATHS)})`,
            `(deny file-read* ${sub(home, SECRET_SUBPATHS)})`,
            '',
        ].join('\n');
        const p = path.join(app.getPath('userData'), 'exec-sandbox.sb');
        fs.writeFileSync(p, profile);
        return p;
    } catch {
        return null;
    }
}

/** 스코프 가드 — 연결 폴더 밖 경로/심링크 탈출을 차단 (서버 safeRealWorkspacePath 등가). */
function safe(rel) {
  const abs = path.resolve(folderRoot, rel || '.');
  if (abs !== folderRoot && !abs.startsWith(folderRoot + path.sep)) throw new Error(`폴더 스코프 밖 경로 거부: ${rel}`);
  // 존재하는 최근접 조상의 realpath 도 스코프 안이어야 함 (컨테이너 없는 로컬은 심링크가 유일한 탈출로).
  let probe = abs;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  if (real !== folderRoot && !real.startsWith(folderRoot + path.sep)) throw new Error(`심링크 스코프 탈출 거부: ${rel}`);
  return abs;
}

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue; // 심링크는 나열하지 않음
    if (e.isDirectory()) walk(p, base, out); else out.push(path.relative(base, p));
    if (out.length >= 1000) return out;
  }
  return out;
}

async function handleExec(m, done) {
  switch (m.kind) {
    case 'exec': {
      // ① 명백히 위험한 패턴은 확인 없이 즉시 거부 (guardrail).
      const denied = matchDenylist(m.command);
      if (denied) { done({ ok: false, error: `위험 명령으로 차단됨: ${denied}`, exitCode: 126 }); return; }
      // ② 나머지는 실행 전 사용자 확인 (비우회).
      if (!(await confirmExec(String(m.command || '')))) {
        done({ ok: false, error: '사용자가 명령 실행을 거부했습니다', exitCode: 126 }); return;
      }
      // ③ OS 샌드박스로 감싸 실행 — 폴더 밖 쓰기·비밀 읽기를 커널이 차단한다.
      //    프로파일 준비 실패 시 fail-closed(비격리 실행 거부). 해제는 OMK_BRIDGE_SANDBOX=0.
      if (SANDBOX_ENABLED && !sandboxProfilePath) {
        done({ ok: false, error: 'exec 샌드박스 프로파일을 준비하지 못해 실행을 거부했습니다(폴더 재연결 필요). 비격리 실행이 필요하면 OMK_BRIDGE_SANDBOX=0 으로 앱을 실행하세요.', exitCode: 126 });
        return;
      }
      const opts = { cwd: folderRoot, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER };
      const cb = (err, stdout, stderr) => {
        done({ ok: true, stdout: String(stdout), stderr: String(stderr), exitCode: err ? (err.code ?? 1) : 0 });
      };
      if (SANDBOX_ENABLED) {
        execFile(SANDBOX_BIN, ['-f', sandboxProfilePath, '/bin/bash', '-c', String(m.command)], opts, cb);
      } else {
        execFile('/bin/bash', ['-c', String(m.command)], opts, cb);
      }
      return;
    }
    case 'read': done({ ok: true, content: fs.readFileSync(safe(m.path), 'utf8') }); return;
    case 'write': {
      const abs = safe(m.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(m.contentB64 || '', 'base64'));
      done({ ok: true }); return;
    }
    case 'list': {
      // 디렉토리는 '/' 접미사 — 모델이 폴더를 파일로 오인해 read 하다 EISDIR 로
      // 실패하고 하위 파일에 못 닿는 문제 방지 (샌드박스 실행기와 동일 규약).
      const entries = fs.readdirSync(safe(m.path), { withFileTypes: true })
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      done({ ok: true, entries });
      return;
    }
    case 'listAll': done({ ok: true, entries: walk(folderRoot, folderRoot, []) }); return;
    case 'delete': {
      const abs = safe(m.path);
      if (abs === folderRoot) throw new Error('연결 폴더 루트는 삭제할 수 없습니다');
      fs.rmSync(abs, { recursive: true, force: true });
      done({ ok: true }); return;
    }
    case 'browser': {
      // 로컬 브라우저(D3) — Electron 내장 Chromium 에서 액션 실행.
      // 전용 세션 파티션이라 사용자 개인 브라우저와 분리되고, 화면에 보이는 패널로 뜬다.
      try {
        agentBrowser.configure({ getWindow: () => mainWin, getFolderRoot: () => folderRoot });
        const out = await agentBrowser.runActions(m.spec || {});
        // 컨테이너 runner 와 동일하게 stdout 에 JSON 을 싣는다(서버 파싱 재사용).
        done({ ok: true, stdout: JSON.stringify(out), exitCode: out.ok ? 0 : 1 });
      } catch (e) {
        done({ ok: false, error: `로컬 브라우저 실행 실패: ${e.message}` });
      }
      return;
    }
    case 'task_end':
      agentBrowser.closeAll();   // 작업 종료 시 브라우저 패널 정리
      done({ ok: true }); return;
    default: done({ ok: false, error: `지원하지 않는 kind: ${m.kind}` });
  }
}

async function authToken(backendUrl) {
  // 테스트 훅(개발 전용): OMK_BRIDGE_TOKEN 이 있으면 세션 쿠키 대신 사용.
  if (process.env.OMK_BRIDGE_TOKEN) return process.env.OMK_BRIDGE_TOKEN;
  const cookies = await session.defaultSession.cookies.get({ url: backendUrl, name: 'auth_token' });
  return cookies[0]?.value || null;
}

function setStatus(s) { statusText = s; onStatusChange(s); }

async function connect(app, backendUrl) {
  if (!folderRoot) return;
  const token = await authToken(backendUrl);
  if (!token) { setStatus('로그인 필요 — 앱에서 로그인 후 다시 연결'); return; }
  wsUrl = backendUrl.replace(/^http/, 'ws');
  try { if (ws) { ws.removeAllListeners(); ws.close(); } } catch { /* noop */ }
  ws = new WebSocket(wsUrl, { headers: { Origin: backendUrl, Cookie: `auth_token=${token}` } });
  setStatus('연결 중…');

  ws.on('open', () => setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'bridge_hello', deviceId: deviceId(app),
      label: `${require('os').hostname()} · ${path.basename(folderRoot)}`,
      folderName: path.basename(folderRoot),
    }));
    // 유휴 세션 연장 — 5분마다 최신 토큰으로 refresh (실패는 close 가 후속 처리)
    clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      try {
        const tok = await authToken(backendUrl);
        if (tok && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'refresh', authToken: tok }));
        }
      } catch { /* noop */ }
    }, REFRESH_MS);
  }, 300));

  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d.toString()); } catch { return; }
    if (m.type === 'bridge_ready') { setStatus(`연결됨: ${path.basename(folderRoot)}`); return; }
    if (m.type !== 'bridge_exec') return;
    const t0 = Date.now();
    const done = (result) => {
      try { ws.send(JSON.stringify({ type: 'bridge_result', reqId: m.reqId, result: { durationMs: Date.now() - t0, ...result } })); } catch { /* noop */ }
    };
    // handleExec 는 async(exec 승인 대기) — sync/async 예외를 모두 done 으로 흡수.
    Promise.resolve().then(() => handleExec(m, done)).catch((e) => done({ ok: false, error: String(e.message || e) }));
  });

  ws.on('close', () => {
    clearInterval(refreshTimer);
    if (!folderRoot) { setStatus('미연결'); return; }
    setStatus('끊김 — 재연결 대기');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(app, backendUrl), RECONNECT_MS);
  });
  ws.on('error', () => { /* close 가 후속 처리 */ });
}

/** 메뉴: 폴더 선택 → 연결. 테스트 훅 OMK_BRIDGE_FOLDER 로 다이얼로그 생략 가능. */
async function connectFolder(app, backendUrl, win) {
  mainWin = win || mainWin;
  let folder = process.env.OMK_BRIDGE_FOLDER;
  if (!folder) {
    const r = await dialog.showOpenDialog(win, {
      title: '에이전트 작업에 연결할 폴더 선택',
      message: '이 폴더를 작업 기준으로 파일을 읽고 씁니다. 셸 명령은 실행 전 매번 확인을 받고, 승인해도 OS 샌드박스가 폴더 밖 쓰기와 비밀 파일(.ssh 등) 읽기를 차단합니다.',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return;
    folder = r.filePaths[0];
  }
  folderRoot = fs.realpathSync(folder);
  // 연결 폴더 기준으로 exec 샌드박스 프로파일 갱신 (폴더가 바뀌면 스코프도 바뀐다).
  sandboxProfilePath = SANDBOX_ENABLED ? writeSandboxProfile(app, folderRoot) : null;
  await connect(app, backendUrl);
}

function disconnectFolder() {
  folderRoot = null;
  clearTimeout(reconnectTimer);
  clearInterval(refreshTimer);
  try { if (ws) ws.close(); } catch { /* noop */ }
  ws = null;
  setStatus('미연결');
}

module.exports = {
  connectFolder,
  disconnectFolder,
  getStatus: () => statusText,
  isConnected: () => !!folderRoot,
  /**
   * 연결된 작업 폴더의 **전체 경로**. 어느 폴더에 붙었는지 사용자가 확인할 수단이
   * 없어(서버에는 basename 만 전달) 같은 이름 폴더를 구분할 수 없던 문제 해소용.
   * 개인정보(사용자명 등)가 포함되므로 **로컬 UI 표시에만** 쓰고 서버로 보내지 않는다.
   */
  getFolderPath: () => folderRoot,
  setOnStatusChange: (fn) => { onStatusChange = fn; },
  /** 백엔드 전환 시 재연결 */
  onBackendChanged: (app, backendUrl) => { if (folderRoot) connect(app, backendUrl); },
};
