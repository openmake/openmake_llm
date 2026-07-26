// Local Bridge (Cowork D1b) — 로컬 실행기: 서버 Agent Task 의 도구 호출을
// 사용자가 연결한 폴더를 작업 기준으로 실행한다. 프로토콜은 서버
// apps/api/src/services/local-bridge/ (D1a) 와 1:1.
//
// 보안 불변식:
//  - 고정 kind 화이트리스트만 처리 (임의 RPC 거부)
//  - 파일 kind(read/write/list/delete)의 경로는 연결 폴더 realpath 스코프 안에서만
//    해석 (심링크 탈출 차단)
//  - ⚠️ exec 는 폴더 스코프에 갇히지 않는다 — 셸 명령은 사용자 계정 권한으로 실행되어
//    폴더 밖 파일·네트워크에도 접근할 수 있다. 그래서 exec 는 ① 명백히 위험한 패턴을
//    디바이스에서 hard-block(EXEC_DENYLIST) 하고 ② 나머지는 실행 전 매번 사용자
//    확인(confirmExec)을 받는다 — 서버 승인 설정과 무관한 비우회 게이트.
//  - 인증은 앱 세션의 auth_token 쿠키 재사용 (토큰을 디스크에 저장하지 않음)
const { session, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const WebSocket = require('ws');

const EXEC_TIMEOUT_MS = 120000;
const MAX_BUFFER = 1024 * 1024;
const RECONNECT_MS = 10000;

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
    detail: `${preview}\n\n연결 폴더: ${folderRoot}\n이 명령은 당신 계정 권한으로 실행되며 폴더 밖 파일·네트워크에도 접근할 수 있습니다.`,
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
      exec(m.command, { cwd: folderRoot, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
        done({ ok: true, stdout: String(stdout), stderr: String(stderr), exitCode: err ? (err.code ?? 1) : 0 });
      });
      return;
    }
    case 'read': done({ ok: true, content: fs.readFileSync(safe(m.path), 'utf8') }); return;
    case 'write': {
      const abs = safe(m.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(m.contentB64 || '', 'base64'));
      done({ ok: true }); return;
    }
    case 'list': done({ ok: true, entries: fs.readdirSync(safe(m.path)) }); return;
    case 'listAll': done({ ok: true, entries: walk(folderRoot, folderRoot, []) }); return;
    case 'delete': {
      const abs = safe(m.path);
      if (abs === folderRoot) throw new Error('연결 폴더 루트는 삭제할 수 없습니다');
      fs.rmSync(abs, { recursive: true, force: true });
      done({ ok: true }); return;
    }
    case 'task_end': done({ ok: true }); return;
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
      message: '이 폴더를 작업 기준으로 파일을 읽고 씁니다. 셸 명령은 실행 전 매번 확인을 받으며, 승인 시 당신 계정 권한으로 실행됩니다(폴더 밖·네트워크 접근 가능).',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return;
    folder = r.filePaths[0];
  }
  folderRoot = fs.realpathSync(folder);
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
  setOnStatusChange: (fn) => { onStatusChange = fn; },
  /** 백엔드 전환 시 재연결 */
  onBackendChanged: (app, backendUrl) => { if (folderRoot) connect(app, backendUrl); },
};
