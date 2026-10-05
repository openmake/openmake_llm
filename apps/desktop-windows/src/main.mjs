/**
 * OpenMake Companion (Windows) — Electron 메인 프로세스.
 *
 * 트레이에 상주하며 폴더 연결·연결 상태·명령 실행 확인 창·승인 대기 알림·브라우저 넘겨받기/중지·설정만 담당한다.
 * 채팅 등 깊은 화면은 웹이 맡는다(macOS Companion 과 같은 역할 분담).
 * 브리지 보안 로직(경로 범위·명령 방어·만료와 중복 검사·사이트 정책 재판정)은 @openmake/local-bridge-core 를 그대로 쓴다 —
 * 여기서 다시 구현하지 않는다. 인증은 bridge 스코프 API key 뿐이다(쿠키 로그인으로 등록하던 옛 Electron 앱의 경로는 서버가 막는다).
 *
 * 개발·검증용 env: OMK_DESKTOP_SERVER · OMK_DESKTOP_API_KEY · OMK_DESKTOP_FOLDER(기동 시 자동 연결) · OMK_DESKTOP_DATA_DIR(데이터 폴더)
 * · OMK_DESKTOP_SMOKE=1(상태 변화를 stdout 에 JSON 줄로 내보내고 확인 창을 자동 승인 — test/smoke.cjs 가 쓴다).
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, shell, Tray } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BridgeConnection, BridgeCore, bulkApprovalAllowed, discoverEndpoints, normalizeServerAddress } from '@openmake/local-bridge-core';
import { AUTH_STATUS_KEYS, pickLocale, translate } from './i18n.mjs';
import { Store, DEFAULT_SERVER } from './store.mjs';
import { pickWindowsUpdate, sha256Of } from './update.mjs';

const SMOKE = process.env.OMK_DESKTOP_SMOKE === '1';
// 앱 아이콘(OpenMake 로고) — build.mjs 가 dist 로 복사한다. 트레이는 작게 줄여 쓴다(Windows 는 고해상도 배율을 위해 32px).
const ICON_PATH = path.join(__dirname, 'icon.png');
const TRAY_ICON_PX = process.platform === 'win32' ? 32 : 18;

let store;
let locale = 'ko';
let tray = null;
let settingsWin = null;
let browserUserControl = false;
/** 연결 폴더(realpath) → { core, connection, status } */
const roots = new Map();
const t = (key, ...args) => translate(locale, key, ...args);
const emit = (ev) => { if (SMOKE) process.stdout.write(`${JSON.stringify(ev)}\n`); };

function settings() {
  const s = store.loadSettings();
  return process.env.OMK_DESKTOP_SERVER ? { ...s, server: process.env.OMK_DESKTOP_SERVER } : s;
}
const apiKey = () => process.env.OMK_DESKTOP_API_KEY || store.loadApiKey();

/**
 * 서버 주소에서 정한 연결 주소·웹 주소(코어 endpoints) — 설정의 주소 하나로 서버에 포트를 물어 정한다.
 * 종전엔 포트 규칙 하나로 웹 주소를 추측해, API 와 웹의 포트가 다른 설치에서 링크가 엉뚱한 곳으로 갔다.
 * 주소마다 한 번만 묻는다. 조회가 안 되면 넣은 주소를 그대로 쓴다.
 */
const endpointsByServer = new Map();
function endpoints() {
  const server = settings().server;
  if (!endpointsByServer.has(server)) {
    endpointsByServer.set(server, discoverEndpoints(server).catch(() => ({ bridgeUrl: server, webUrl: server, discovered: false })));
  }
  return endpointsByServer.get(server);
}
const openWeb = async (suffix = '') => shell.openExternal(`${(await endpoints()).webUrl}${suffix}`);

function statusText() {
  if (!apiKey()) return t('status.needKey');
  if (roots.size === 0) return t('status.idle');
  return [...roots.values()].map((r) => r.status).join(' · ');
}

async function confirmExec(command, _taskId, base) {
  if (SMOKE) return 'yes';
  // 명령을 OS 샌드박스로 가두지 못하는 Windows 에서는 일괄 승인 단추를 내놓지 않는다(코어도 받지 않는다).
  const buttons = bulkApprovalAllowed() ? [t('confirm.allow'), t('confirm.allowAll'), t('confirm.deny')] : [t('confirm.allow'), t('confirm.deny')];
  const { response } = await dialog.showMessageBox({
    type: 'warning', title: t('confirm.title'), message: t('confirm.message'), detail: t('confirm.detail', base, command),
    buttons, defaultId: buttons.length - 1, cancelId: buttons.length - 1, noLink: true,
  });
  if (response === 0) return 'yes';
  return bulkApprovalAllowed() && response === 1 ? 'all' : 'no';
}

async function connectFolder(folder) {
  let real;
  try { real = fs.realpathSync(folder); } catch { return; }
  const { bridgeUrl } = await endpoints();
  roots.get(real)?.connection.disconnect();
  const cfg = settings();
  const core = new BridgeCore({
    folder: real,
    confirm: confirmExec,
    sandboxProfileDir: app.getPath('userData'),
    onAutoApproveChange: rebuildMenu,
    // 로컬 브라우저 — 설정에서 켰을 때만. 평소 쓰는 Chrome 프로필이 아닌 앱 데이터 폴더 아래 전용 프로필.
    ...(cfg.browserEnabled ? { browserProfileDir: path.join(app.getPath('userData'), 'browser-profile') } : {}),
  });
  const entry = { core, connection: null, status: t('status.connecting') };
  entry.connection = new BridgeConnection({
    serverUrl: bridgeUrl,
    core,
    deviceId: store.deviceIdFor(real),
    hostId: store.hostId(),
    label: `${os.hostname()} · ${path.basename(real)}`,
    headers: () => ({ Authorization: `Bearer ${apiKey()}` }),
    onStatus: (_s, code, arg) => {
      entry.status = code === 'connected' ? `${t('status.connected')}: ${path.basename(real)}`
        : code === 'reconnecting' ? t('status.reconnecting')
          : code === 'server_error' ? t('status.serverError', arg ?? '')
            : AUTH_STATUS_KEYS[code] ? t(AUTH_STATUS_KEYS[code]) : t('status.connecting');
      emit({ ev: 'status', folder: real, code });
      rebuildMenu();
    },
    onNotice: (n) => {
      const note = new Notification({ title: t('notice.approval.title'), body: t('notice.approval.body', n.toolName) });
      note.on('click', () => { void openWeb(`/agent-tasks?task=${encodeURIComponent(n.taskId)}`); });
      note.show();
    },
    shouldReconnect: () => roots.has(real),
  });
  roots.set(real, entry);
  void entry.connection.connect();
  store.saveSettings({ folders: [...roots.keys()] });
  rebuildMenu();
}

function disconnectFolder(real) {
  const r = roots.get(real);
  if (!r) return;
  roots.delete(real);
  r.connection.disconnect();
  store.saveSettings({ folders: [...roots.keys()] });
  rebuildMenu();
}

async function chooseFolder() {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!r.canceled && r.filePaths[0]) await connectFolder(r.filePaths[0]);
}

function setBrowserUserControl(on) {
  browserUserControl = on;
  for (const r of roots.values()) {
    r.core.setBrowserUserControl(on);
    r.connection?.notifyBrowserControl(on); // 서버에 알린다 — 돌려주면 넘겨받기로 멈춘 작업이 이어서 실행된다
  }
  rebuildMenu();
}

function rebuildMenu() {
  if (!tray) return;
  const items = [{ label: t('menu.status', statusText()), enabled: false }, { type: 'separator' }];
  for (const real of roots.keys()) {
    items.push({ label: path.basename(real), submenu: [
      { label: real, enabled: false },
      { label: t('menu.disconnect'), click: () => disconnectFolder(real) },
    ] });
  }
  items.push({ label: roots.size === 0 ? t('menu.connectFolder') : t('menu.addFolder'), enabled: !!apiKey(), click: () => { void chooseFolder(); } });
  if (roots.size > 1) items.push({ label: t('menu.disconnectAll'), click: () => { for (const real of [...roots.keys()]) disconnectFolder(real); } });
  if (settings().browserEnabled && roots.size > 0) {
    items.push({ type: 'separator' },
      { label: browserUserControl ? t('menu.browser.release') : t('menu.browser.takeover'), click: () => setBrowserUserControl(!browserUserControl) },
      { label: t('menu.browser.stop'), click: () => { for (const r of roots.values()) r.core.stopBrowser(); } });
  }
  items.push({ type: 'separator' },
    { label: t('menu.openWeb'), click: () => { void openWeb(); } },
    { label: t('menu.checkUpdates'), click: () => { void checkForUpdates(true); } },
    { label: t('menu.settings'), click: openSettings },
    { label: t('menu.quit'), click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(`${t('tray.tooltip')} — ${statusText()}`);
}

/**
 * 업데이트 확인 — 서버의 Windows 블록이 현재보다 새 버전이면 묻고, 설치 파일을 받아 sha256 을 대조한 뒤에만 실행한다.
 * manual=true(메뉴에서 실행)면 "최신"·실패도 알린다. 기동 때의 자동 확인은 새 버전이 있을 때만 묻는다.
 */
async function checkForUpdates(manual) {
  try {
    const server = settings().server;
    const res = await fetch(`${server}/api/desktop/latest`);
    const update = res.ok ? pickWindowsUpdate((await res.json())?.data, app.getVersion()) : null;
    if (!update) {
      if (manual) await dialog.showMessageBox({ type: 'info', title: t('update.title'), message: t('update.none') });
      return;
    }
    const { response } = await dialog.showMessageBox({
      type: 'question', title: t('update.title'), message: t('update.available', update.version),
      buttons: [t('update.install'), t('update.later')], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (response !== 0) return;
    const file = await fetch(`${server}${update.path}`);
    if (!file.ok) throw new Error(`HTTP ${file.status}`);
    const data = Buffer.from(await file.arrayBuffer());
    if (sha256Of(data) !== update.sha256) {
      await dialog.showMessageBox({ type: 'error', title: t('update.title'), message: t('update.badHash') });
      return;
    }
    const target = path.join(app.getPath('temp'), update.file);
    fs.writeFileSync(target, data);
    const failed = await shell.openPath(target); // 설치 프로그램 실행 — 빈 문자열이면 성공
    if (failed) throw new Error(failed);
    app.quit();
  } catch (e) {
    if (manual) await dialog.showMessageBox({ type: 'error', title: t('update.title'), message: t('update.failed', e instanceof Error ? e.message : String(e)) });
  }
}

function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 480, height: 380, resizable: false, title: t('settings.title'), autoHideMenuBar: true, icon: ICON_PATH,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  settingsWin.on('closed', () => { settingsWin = null; });
  void settingsWin.loadFile(path.join(__dirname, 'settings.html'));
}

function registerIpc() {
  ipcMain.handle('settings:get', () => {
    const s = settings();
    const keys = ['settings.title', 'settings.server', 'settings.serverHelp', 'settings.serverInsecure', 'settings.serverInvalid', 'settings.apiKey', 'settings.browser', 'settings.save', 'settings.saved', 'settings.noEncryption'];
    // API key 원문은 화면으로 돌려보내지 않는다 — 저장돼 있는지만 알린다.
    return { server: s.server, browserEnabled: s.browserEnabled, hasApiKey: !!apiKey(), text: Object.fromEntries(keys.map((k) => [k, t(k)])) };
  });
  ipcMain.handle('settings:save', (_e, input) => {
    const prev = settings();
    // 서버 주소 — 빈 칸은 기본 주소. http(s) 주소가 아니면 아무것도 저장하지 않는다.
    const entered = typeof input?.server === 'string' ? input.server.trim() : null;
    const server = entered === null ? prev.server : entered === '' ? DEFAULT_SERVER : normalizeServerAddress(entered);
    if (!server) return { ok: false, reason: 'server' };
    const next = store.saveSettings({
      server,
      browserEnabled: input?.browserEnabled === true,
    });
    // 빈 입력은 "바꾸지 않음" — 저장된 key 를 지우지 않는다.
    const keySaved = typeof input?.apiKey === 'string' && input.apiKey.trim() ? store.saveApiKey(input.apiKey) : true;
    // 서버 주소·브라우저 사용이 바뀌었거나 key 가 새로 들어왔으면 연결을 다시 만든다.
    if (prev.server !== next.server || prev.browserEnabled !== next.browserEnabled || (typeof input?.apiKey === 'string' && input.apiKey.trim())) {
      for (const real of [...roots.keys()]) void connectFolder(real);
    }
    rebuildMenu();
    return { ok: keySaved, server: next.server, ...(keySaved ? {} : { reason: 'encryption' }) };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('window-all-closed', () => { /* 트레이 앱 — 창이 없어도 떠 있는다 */ });
  app.on('before-quit', () => { for (const r of roots.values()) r.connection.disconnect(); });
  void app.whenReady().then(() => {
    if (process.env.OMK_DESKTOP_DATA_DIR) app.setPath('userData', process.env.OMK_DESKTOP_DATA_DIR);
    store = new Store(app.getPath('userData'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (text) => safeStorage.encryptString(text),
      decrypt: (buf) => safeStorage.decryptString(buf),
    });
    locale = pickLocale(app.getLocale());
    if (process.platform === 'darwin') app.dock?.hide();
    registerIpc();
    const trayIcon = nativeImage.createFromPath(ICON_PATH).resize({ width: TRAY_ICON_PX, height: TRAY_ICON_PX });
    tray = new Tray(trayIcon);
    rebuildMenu();
    emit({ ev: 'ready', locale, trayIcon: !trayIcon.isEmpty() });
    const startFolders = process.env.OMK_DESKTOP_FOLDER ? [process.env.OMK_DESKTOP_FOLDER] : settings().folders;
    if (apiKey()) for (const f of startFolders) void connectFolder(f);
    // Windows 에서만 자동으로 확인한다 — 다른 OS 에서 이 앱은 개발용이다. 검증 실행 중에는 확인 창을 띄우지 않는다.
    if (process.platform === 'win32' && !SMOKE) void checkForUpdates(false);
  });
}
