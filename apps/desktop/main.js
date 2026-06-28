// OpenMake LLM 데스크톱 셸 (Electron, macOS)
// 운영 백엔드(외부 Tailscale Funnel / 로컬 localhost)를 네이티브 창으로 로드한다.
// 백엔드 자체(API·Docker·vLLM)는 번들하지 않고 기존 운영에 연결만 한다 — 의존성(Docker
// DB·원격 GPU)을 dmg 에 담을 수 없기 때문. 백엔드 전환은 메뉴 '백엔드' 의 라디오로.

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const BACKENDS = {
  external: 'https://ijaesang-ui-macmini.tail67d660.ts.net',
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

  buildMenu();
}

function switchBackend(b) {
  if (!BACKENDS[b] || b === current) return;
  current = b;
  saveBackend(b);
  buildMenu();
  if (win) win.loadURL(BACKENDS[b]);
}

function buildMenu() {
  const template = [
    { role: 'appMenu' },
    {
      label: '백엔드',
      submenu: [
        { label: '외부 (Tailscale)', type: 'radio', checked: current === 'external', click: () => switchBackend('external') },
        { label: '로컬 (localhost:3000)', type: 'radio', checked: current === 'local', click: () => switchBackend('local') },
        { type: 'separator' },
        { label: '새로고침', accelerator: 'CmdOrCtrl+R', click: () => win && win.reload() },
        { label: '강제 새로고침(캐시 무시)', accelerator: 'CmdOrCtrl+Shift+R', click: () => win && win.webContents.reloadIgnoringCache() },
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
