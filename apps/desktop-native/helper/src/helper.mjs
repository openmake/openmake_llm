// OpenMake Companion 헬퍼 — @openmake/local-bridge-core 의 네이티브 앱(SwiftUI) 어댑터.
//
// 프로토콜·경로 스코프·exec 3단 방어·worktree 격리는 전부 코어 패키지가 담당한다
// (CLI 와 동일 코어 — 보안 코드 재구현 금지 원칙, plan §3).
// 이 파일은 호스트 차이만 남는다:
//   - 인증: API key(omk_live_*) Authorization 헤더 (CLI 와 동일 계약).
//     key 는 argv 가 아니라 env(OMK_COMPANION_API_KEY)로 받는다 — ps 인자 노출 방지.
//   - confirmExec: stdio JSON-lines 로 부모(네이티브 앱)에 위임 — 비우회 사용자 확인의
//     선택 주체는 항상 앱의 네이티브 다이얼로그(사용자)다. stdin 소실 시 'no'(fail-safe).
//   - deviceId·샌드박스 프로파일: ~/Library/Application Support/OpenMakeCompanion
//
// 다중 루트(0.2.0): 루트당 독립 BridgeCore+BridgeConnection, deviceId 는 기기 base id +
// 루트 경로 해시 파생(재접속 안정) — 서버는 루트마다 별개 디바이스로 본다(프로토콜 무변경,
// 유저당 LOCAL_BRIDGE_MAX_DEVICES 상한은 서버가 강제하고 초과는 status 로 표면화).
//
// 승인 대기 알림(0.2.6): 서버 bridge_notice 를 코어가 검증해 onNotice 로 넘기면 approvalPending
// 이벤트로 앱에 전달한다(앱이 네이티브 알림). 상태 이벤트엔 다국어 표시용 code·arg 를 싣는다
// (text 는 한국어 원문 — 코드를 모르는 소비자용 폴백).
//
// stdio 계약 (한 줄 = JSON 하나, folder = 루트 realpath):
//   helper→app: {ev:'status',folder?,text,code?,arg?} {ev:'confirm',id,command,taskId,base,folder,sandbox}
//               {ev:'autoApprove',count}(전 루트 합계) {ev:'taskEnd',taskId,folder}
//               {ev:'approvalPending',taskId,toolName,folder}
//               {ev:'connected',folder} {ev:'disconnected',folder}
//               {ev:'endpoints',webUrl,bridgeUrl,discovered} — 기동 직후 한 번(서버 주소에서 정한 연결·웹 주소)
//   app→helper: {cmd:'connect',folder} {cmd:'disconnect',folder?}(folder 없으면 전체)
//               {cmd:'confirm',id,result:'yes'|'all'|'no'} {cmd:'clearAutoApprove'} {cmd:'quit'}
//   status code: connecting·connected(arg=폴더명)·server_error(arg=메시지)·reconnecting·closed·idle·
//                auth_error(arg=메시지)·api_key_required·folder_open_failed(arg=메시지)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as readline from 'readline';
import { BridgeConnection, BridgeCore, SANDBOX_ENABLED, discoverEndpoints } from '../../../../packages/local-bridge-core/dist/index.js';

const serverUrl = (() => {
  const i = process.argv.indexOf('--server');
  return i >= 0 ? process.argv[i + 1] : 'https://chat.openmake.cc';
})();
const apiKey = process.env.OMK_COMPANION_API_KEY || '';

// 서버 주소 찾기 — 사용자가 넣은 주소 하나(--server)에서 연결 주소와 웹 주소를 정한다(코어 endpoints).
// 주소가 잘못됐으면 넣은 값을 그대로 쓴다(연결 단계에서 오류로 드러난다).
const endpointsReady = discoverEndpoints(serverUrl).catch(() => ({ bridgeUrl: serverUrl, webUrl: serverUrl, discovered: false }));

// `--resolve`: 주소만 찾아 한 줄로 내고 끝낸다 — 앱이 API key 를 넣기 전(키 발급 페이지를 열 때)에도 웹 주소를 알 수 있게.
const RESOLVE_ONLY = process.argv.includes('--resolve');
if (RESOLVE_ONLY) {
  endpointsReady.then((e) => { process.stdout.write(JSON.stringify(e) + '\n'); process.exit(0); });
}

const SUPPORT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'OpenMakeCompanion');
fs.mkdirSync(SUPPORT_DIR, { recursive: true });
/** 로컬 브라우저 — 앱이 OMK_COMPANION_BROWSER=1 로 켠다(설정의 "브라우저 사용 허용"). 전용 프로필은 앱 데이터 폴더 아래. */
const BROWSER_ENABLED = process.env.OMK_COMPANION_BROWSER === '1';
const BROWSER_PROFILE_DIR = path.join(SUPPORT_DIR, 'browser-profile');

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function baseDeviceId() {
  const p = path.join(SUPPORT_DIR, 'device-id');
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* 최초 생성 */ }
  const id = crypto.randomUUID();
  try { fs.writeFileSync(p, id); } catch { /* noop */ }
  return id;
}

/** 루트별 파생 deviceId — 재접속 시 같은 값(서버 세션 대체 규칙과 정합). 36+3+12=51 ≤ 서버 64 상한. */
function rootDeviceId(root) {
  return `${baseDeviceId()}-r-${crypto.createHash('sha256').update(root).digest('hex').slice(0, 12)}`;
}

// confirm 왕복 — id 상관. 앱이 죽으면(stdin close) 전 대기를 'no' 로 해소하고 종료.
let confirmSeq = 0;
const pendingConfirms = new Map(); // id -> resolve

/** 연결 루트들 — realpath → {core, connection} */
const roots = new Map();

function totalAutoApprove() {
  let n = 0;
  for (const r of roots.values()) n += r.core.autoApprovedCount();
  return n;
}

async function connectFolder(folder) {
  const { bridgeUrl } = await endpointsReady;
  if (!apiKey) { send({ ev: 'status', text: 'API key 필요 — 앱 설정에서 입력', code: 'api_key_required' }); return; }
  let real;
  try { real = fs.realpathSync(folder); } catch (e) {
    send({ ev: 'status', text: `폴더 열기 실패: ${e.message}`, code: 'folder_open_failed', arg: e.message });
    return;
  }
  const prev = roots.get(real);
  if (prev) prev.connection.disconnect(); // 같은 루트 재연결 = 세션 갱신
  const core = new BridgeCore({
    folder: real,
    confirm: (command, taskId, base) => new Promise((resolve) => {
      const id = ++confirmSeq;
      pendingConfirms.set(id, resolve);
      send({ ev: 'confirm', id, command, taskId: taskId ?? null, base, folder: real, sandbox: SANDBOX_ENABLED });
    }),
    sandboxProfileDir: SUPPORT_DIR,
    // 로컬 브라우저(P2) — 앱 설정에서 켰을 때만 전용 프로필을 넘긴다. 사용자의 평소 Chrome 프로필이 아니다.
    ...(BROWSER_ENABLED ? { browserProfileDir: BROWSER_PROFILE_DIR } : {}),
    onTaskEnd: (taskId) => send({ ev: 'taskEnd', taskId: taskId ?? null, folder: real }),
    onAutoApproveChange: () => send({ ev: 'autoApprove', count: totalAutoApprove() }),
  });
  const connection = new BridgeConnection({
    serverUrl: bridgeUrl,
    core,
    deviceId: rootDeviceId(real),
    hostId: baseDeviceId(), // 폴더별 연결이 같은 PC 임을 서버에 알린다 — 기기 상한을 PC 단위로 센다
    label: `${os.hostname()} · ${path.basename(real)}`,
    headers: () => ({ Authorization: `Bearer ${apiKey}` }),
    onStatus: (s, code, arg) => send({ ev: 'status', folder: real, text: s, ...(code ? { code } : {}), ...(arg !== undefined ? { arg } : {}) }),
    onNotice: (n) => send({ ev: 'approvalPending', taskId: n.taskId, toolName: n.toolName, folder: real }),
    shouldReconnect: () => roots.has(real),
  });
  roots.set(real, { core, connection });
  void connection.connect();
  send({ ev: 'connected', folder: real });
}

function disconnectFolder(folder) {
  if (folder === undefined) { // 전체 해제 (구 계약 호환)
    for (const real of [...roots.keys()]) disconnectFolder(real);
    return;
  }
  let real = folder;
  try { real = fs.realpathSync(folder); } catch { /* 이미 삭제된 폴더도 등록 키로 시도 */ }
  const r = roots.get(real) ?? roots.get(folder);
  const key = roots.has(real) ? real : folder;
  if (!r) return;
  roots.delete(key);                 // shouldReconnect 가 false 가 된 뒤 끊는다
  r.connection.disconnect();         // 일괄 승인 회수 포함
  send({ ev: 'disconnected', folder: key });
  send({ ev: 'autoApprove', count: totalAutoApprove() });
  if (roots.size === 0) send({ ev: 'status', text: '미연결', code: 'idle' });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  switch (m.cmd) {
    case 'connect': if (typeof m.folder === 'string') void connectFolder(m.folder); break;
    case 'disconnect': disconnectFolder(typeof m.folder === 'string' ? m.folder : undefined); break;
    case 'confirm': {
      const resolve = pendingConfirms.get(m.id);
      if (resolve) {
        pendingConfirms.delete(m.id);
        resolve(m.result === 'yes' || m.result === 'all' ? m.result : 'no');
      }
      break;
    }
    case 'clearAutoApprove': for (const r of roots.values()) r.core.clearAutoApprove(); break;
    // 브라우저 제어권(P2) — 사용자가 넘겨받으면 에이전트의 브라우저 요청을 실행하지 않는다. 브라우저는 루트들이 공유한다.
    case 'browserControl': {
      const user = m.user === true;
      for (const r of roots.values()) {
        r.core.setBrowserUserControl(user);
        r.connection.notifyBrowserControl(user); // 서버에 알린다 — 돌려주면 넘겨받기로 멈춘 작업이 이어서 실행된다
      }
      send({ ev: 'browserControl', user });
      break;
    }
    case 'browserStop': for (const r of roots.values()) r.core.stopBrowser(); send({ ev: 'browserStopped' }); break;
    case 'quit': shutdown(); break;
    default: break;
  }
});

// 부모 앱 사망(stdin 종료) = 좀비 방지 최후 방어선 — 대기 confirm 전부 거부 후 종료.
// 거부 결과가 서버로 송신될 시간(microtask + WS flush)을 준 뒤 연결을 닫는다 —
// 즉시 exit 하면 서버는 거부 대신 요청 타임아웃을 겪는다.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown || RESOLVE_ONLY) return; // 조회 전용 실행은 결과를 낸 뒤 스스로 끝난다
  shuttingDown = true;
  for (const resolve of pendingConfirms.values()) resolve('no');
  pendingConfirms.clear();
  setTimeout(() => { disconnectFolder(undefined); process.exit(0); }, 100);
}
rl.on('close', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (!RESOLVE_ONLY) {
  send({ ev: 'status', text: '미연결', code: 'idle' });
  endpointsReady.then((e) => send({ ev: 'endpoints', ...e }));
}
