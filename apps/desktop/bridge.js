// Local Bridge (Cowork D1b) — 로컬 실행기: 서버 Agent Task 의 도구 호출을
// 사용자가 연결한 폴더를 작업 기준으로 실행한다. 프로토콜은 서버
// apps/api/src/services/local-bridge/ (D1a) 와 1:1.
//
// 2026-08-22 코어 추출(축2 plan 1단계): 프로토콜 상태기계·경로 스코프·exec 3단 방어·
// worktree 격리는 ./local-bridge-core (packages/local-bridge-core 빌드 복사본 —
// scripts/copy-desktop-bridge-core.mjs, prestart/predist 훅) 가 담당한다. 이 파일은
// Electron 호스트 어댑터만 남는다:
//  - 인증: 앱 세션의 auth_token 쿠키 재사용 (토큰을 디스크에 저장하지 않음) + 주기 refresh
//  - confirmExec: dialog 3버튼 (실행 / 이 작업 동안 모두 실행 / 거부)
//  - browser kind(D3): 전용 세션 파티션의 Electron 내장 Chromium (agent-browser)
//  - deviceId·샌드박스 프로파일: userData
// 보안 불변식(코어): 고정 kind 화이트리스트, realpath 스코프(심링크 탈출 차단),
// exec = DENYLIST hard-block → confirmExec(비우회) → sandbox-exec fail-closed,
// 일괄 승인은 그 작업 한정(task_end·해제 시 회수, 선택 주체는 항상 사용자).
const { session, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const agentBrowser = require('./agent-browser');
const { BridgeCore, BridgeConnection, SANDBOX_ENABLED } = require('./local-bridge-core');

// 서버 WS 하트비트는 액세스 토큰 만료 시 연결을 terminate 한다 — 세션 쿠키에서 최신
// 토큰을 읽어 기존 refresh 프로토콜({type:'refresh'})로 주기 연장해 유휴 플랩을 막는다.
const REFRESH_MS = parseInt(process.env.OMK_BRIDGE_REFRESH_MS || '300000', 10);

let core = null;             // BridgeCore (연결 폴더별 재생성)
let connection = null;       // BridgeConnection
let folderRoot = null;       // realpath 확정된 연결 폴더 (null=미연결)
let statusText = '미연결';
let onStatusChange = () => {};
let mainWin = null;          // exec 확인 다이얼로그의 부모 창

function setStatus(s) { statusText = s; onStatusChange(s); }
/** 메뉴 라벨(자동 승인 중 표시) 갱신 훅 — main.js 가 setOnStatusChange 로 주입한 콜백 재사용. */
function buildMenuHook() { try { onStatusChange(statusText); } catch { /* noop */ } }

function deviceId(app) {
  const p = path.join(app.getPath('userData'), 'device-id');
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* 최초 생성 */ }
  const id = crypto.randomUUID();
  try { fs.writeFileSync(p, id); } catch { /* noop */ }
  return id;
}

async function authToken(backendUrl) {
  // 테스트 훅(개발 전용): OMK_BRIDGE_TOKEN 이 있으면 세션 쿠키 대신 사용.
  if (process.env.OMK_BRIDGE_TOKEN) return process.env.OMK_BRIDGE_TOKEN;
  const cookies = await session.defaultSession.cookies.get({ url: backendUrl, name: 'auth_token' });
  return cookies[0]?.value || null;
}

/** confirm 어댑터 — dialog 3버튼을 코어 계약('yes'|'all'|'no')으로 변환. 실행될 명령 원문을 그대로 보여준다. */
async function dialogConfirm(command, taskId, base) {
  const preview = command.length > 800 ? command.slice(0, 800) + '…' : command;
  const r = await dialog.showMessageBox(mainWin || undefined, {
    type: 'warning',
    message: '에이전트가 이 셸 명령을 당신의 컴퓨터에서 실행하려고 합니다',
    // 폴더 선택 시 유효 실행 폴더(base)를 보여준다 — 어느 폴더에서 도는지 투명하게.
    detail: `${preview}\n\n실행 폴더: ${base || folderRoot}\n${SANDBOX_ENABLED
      ? 'OS 샌드박스 적용: 폴더 밖 쓰기와 비밀 파일(.ssh/.aws 등) 읽기는 차단됩니다. 그 외 읽기·네트워크는 허용됩니다.'
      : '⚠️ 샌드박스 미적용: 이 명령은 당신 계정 권한으로 폴더 밖 파일·네트워크에 접근할 수 있습니다.'}${
      taskId ? '\n\n"이 작업 동안 모두 실행"을 고르면 이 작업이 끝날 때까지 다시 묻지 않습니다(다른 작업에는 적용되지 않습니다).' : ''}`,
    buttons: taskId ? ['실행', '이 작업 동안 모두 실행', '거부'] : ['실행', '거부'],
    defaultId: taskId ? 2 : 1,
    cancelId: taskId ? 2 : 1,
    noLink: true,
  });
  if (taskId && r.response === 1) return 'all';
  return r.response === 0 ? 'yes' : 'no';
}

function buildBridge(app, backendUrl) {
  core = new BridgeCore({
    folder: folderRoot,
    confirm: dialogConfirm,
    sandboxProfileDir: app.getPath('userData'),
    onAutoApproveChange: buildMenuHook,
    onTaskEnd: () => agentBrowser.closeAll(),   // 작업 종료 시 브라우저 패널 정리
    browser: async (spec) => {
      // 로컬 브라우저(D3) — 전용 세션 파티션이라 사용자 개인 브라우저와 분리, 화면에 보이는 패널.
      agentBrowser.configure({ getWindow: () => mainWin, getFolderRoot: () => folderRoot });
      return agentBrowser.runActions(spec || {});
    },
  });
  connection = new BridgeConnection({
    serverUrl: backendUrl,
    core,
    deviceId: deviceId(app),
    label: `${os.hostname()} · ${path.basename(folderRoot)}`,
    // 매 (재)연결마다 최신 세션 쿠키를 읽는다. 토큰 부재는 throw — 코어가 재연결 없이
    // 상태만 알리고 정지한다(종전 의미: 로그인 후 사용자가 메뉴에서 다시 연결).
    headers: async () => {
      const token = await authToken(backendUrl);
      if (!token) throw new Error('로그인 필요 — 앱에서 로그인 후 다시 연결');
      return { Origin: backendUrl, Cookie: `auth_token=${token}` };
    },
    onStatus: setStatus,
    // 유휴 세션 연장 — 5분마다 최신 토큰으로 refresh (실패는 close 가 후속 처리)
    onOpen: (ws) => {
      const timer = setInterval(async () => {
        try {
          const tok = await authToken(backendUrl);
          if (tok && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'refresh', authToken: tok }));
          }
        } catch { /* noop */ }
      }, REFRESH_MS);
      return () => clearInterval(timer);
    },
    shouldReconnect: () => !!folderRoot,
  });
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
  if (connection) connection.disconnect();
  buildBridge(app, backendUrl); // 폴더가 바뀌면 샌드박스 스코프·PATH(mise 프로젝트 버전)도 바뀐다 — 코어 재생성
  await connection.connect();
}

function disconnectFolder() {
  folderRoot = null;
  if (connection) connection.disconnect(); // 일괄 승인 회수 포함(다음 연결로 새지 않게)
  connection = null;
  core = null;
  buildMenuHook();
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
  /** 일괄 승인 중인 작업 수 — 메뉴에 노출해 사용자가 상태를 인지하게 한다. */
  autoApprovedCount: () => (core ? core.autoApprovedCount() : 0),
  /** 일괄 승인 전체 해제 — 메뉴에서 즉시 회수할 수 있어야 한다. */
  clearAutoApprove: () => { if (core) core.clearAutoApprove(); },
  setOnStatusChange: (fn) => { onStatusChange = fn; },
  /** 백엔드 전환 시 재연결 */
  onBackendChanged: (app, backendUrl) => {
    if (!folderRoot) return;
    if (connection) connection.disconnect();
    buildBridge(app, backendUrl);
    void connection.connect();
  },
};
