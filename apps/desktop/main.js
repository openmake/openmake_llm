// OpenMake LLM 데스크톱 셸 (Electron, macOS)
// 운영 백엔드(외부 공개 도메인 / 로컬 localhost)를 네이티브 창으로 로드한다.
// 백엔드 자체(API·Docker·vLLM)는 번들하지 않고 기존 운영에 연결만 한다 — 의존성(Docker
// DB·원격 GPU)을 dmg 에 담을 수 없기 때문. 백엔드 전환은 메뉴 '백엔드' 의 라디오로.

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const bridge = require('./bridge');
const updater = require('./updater');

const BACKENDS = {
  external: 'https://chat.openmake.cc',
  local: 'http://localhost:3000',
};

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function loadBackend() {
  try {
    const b = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).backend;
    return BACKENDS[b] ? b : 'external';
  } catch {
    return 'external';
  }
}

function saveBackend(b) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify({ backend: b })); } catch { /* noop */ }
}

let win;
let current = 'external';

function createWindow() {
  current = loadBackend();
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 600,
    title: 'OpenMake',
    backgroundColor: '#0e1014',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(BACKENDS[current]);

  // 앱 내 target=_blank / 외부 도메인 링크는 시스템 기본 브라우저로 연다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 로드 실패(백엔드 미기동 등) 시 간단 안내.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3) return; // aborted (정상 재로드)
    const msg = `백엔드에 연결할 수 없습니다.\\n${url}\\n(${desc})\\n\\n메뉴 '백엔드' 에서 외부/로컬을 전환하거나 서버 상태를 확인하세요.`;
    win.webContents.executeJavaScript(
      `document.body.innerHTML='<div style="font-family:-apple-system;color:#eceef2;background:#0e1014;height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-line;padding:24px">${msg}</div>'`,
    ).catch(() => { /* noop */ });
  });

  bridge.setOnStatusChange(() => buildMenu()); // 상태 라벨 갱신
  buildMenu();
  // 테스트 훅(개발 전용): 폴더가 env 로 지정되면 다이얼로그 없이 자동 연결.
  if (process.env.OMK_BRIDGE_FOLDER) bridge.connectFolder(app, bridgeBackendUrl(), win);
  // 기동 5초 후 자동 업데이트 확인 — 새 버전 있을 때만 다이얼로그.
  updater.scheduleStartupCheck(() => bridgeBackendUrl(), () => win);
}

function switchBackend(b) {
  if (!BACKENDS[b] || b === current) return;
  current = b;
  saveBackend(b);
  buildMenu();
  if (win) win.loadURL(BACKENDS[b]);
  bridge.onBackendChanged(app, bridgeBackendUrl());
}

// 브리지 WS 대상 — 로컬 모드는 Next(3000)가 WS 를 프록시하지 못하므로 백엔드(52416) 직결.
function bridgeBackendUrl() {
  return current === 'local' ? 'http://localhost:52416' : BACKENDS.external;
}

function buildMenu() {
  const template = [
    { role: 'appMenu' },
    {
      label: '백엔드',
      submenu: [
        { label: '외부 (chat.openmake.cc)', type: 'radio', checked: current === 'external', click: () => switchBackend('external') },
        { label: '로컬 (localhost:3000)', type: 'radio', checked: current === 'local', click: () => switchBackend('local') },
        { type: 'separator' },
        { label: '새로고침', accelerator: 'CmdOrCtrl+R', click: () => win && win.reload() },
        { label: '강제 새로고침(캐시 무시)', accelerator: 'CmdOrCtrl+Shift+R', click: () => win && win.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: `업데이트 확인… (현재 v${app.getVersion()})`, click: () => updater.checkForUpdate(bridgeBackendUrl(), win, true) },
      ],
    },
    {
      label: '로컬 작업',
      submenu: [
        { label: `상태: ${bridge.getStatus()}`, enabled: false },
        { type: 'separator' },
        { label: '작업 폴더 연결…', click: () => bridge.connectFolder(app, bridgeBackendUrl(), win) },
        { label: '연결 해제', enabled: bridge.isConnected(), click: () => bridge.disconnectFolder() },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
