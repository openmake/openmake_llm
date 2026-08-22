// OpenMake Companion 헬퍼 — @openmake/local-bridge-core 의 네이티브 앱(SwiftUI) 어댑터.
//
// 프로토콜·경로 스코프·exec 3단 방어·worktree 격리는 전부 코어 패키지가 담당한다
// (데스크톱 Electron·CLI 와 동일 코어 — 보안 코드 재구현 금지 원칙, plan §3).
// 이 파일은 호스트 차이만 남는다:
//   - 인증: API key(omk_live_*) Authorization 헤더 (CLI 와 동일 계약).
//     key 는 argv 가 아니라 env(OMK_COMPANION_API_KEY)로 받는다 — ps 인자 노출 방지.
//   - confirmExec: stdio JSON-lines 로 부모(네이티브 앱)에 위임 — 비우회 사용자 확인의
//     선택 주체는 항상 앱의 네이티브 다이얼로그(사용자)다. stdin 소실 시 'no'(fail-safe).
//   - browser: 미지원 → 코어가 거부 응답 (capability 미보고 degrade)
//   - deviceId·샌드박스 프로파일: ~/Library/Application Support/OpenMakeCompanion
//
// stdio 계약 (한 줄 = JSON 하나):
//   helper→app: {ev:'status',text} {ev:'confirm',id,command,taskId,base,sandbox}
//               {ev:'autoApprove',count} {ev:'taskEnd',taskId} {ev:'connected',folder}
//   app→helper: {cmd:'connect',folder} {cmd:'disconnect'}
//               {cmd:'confirm',id,result:'yes'|'all'|'no'} {cmd:'clearAutoApprove'} {cmd:'quit'}
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as readline from 'readline';
import { BridgeConnection, BridgeCore, SANDBOX_ENABLED } from '../../../../packages/local-bridge-core/dist/index.js';

const serverUrl = (() => {
  const i = process.argv.indexOf('--server');
  return i >= 0 ? process.argv[i + 1] : 'https://chat.openmake.cc';
})();
const apiKey = process.env.OMK_COMPANION_API_KEY || '';

const SUPPORT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'OpenMakeCompanion');
fs.mkdirSync(SUPPORT_DIR, { recursive: true });

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function deviceId() {
  const p = path.join(SUPPORT_DIR, 'device-id');
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* 최초 생성 */ }
  const id = crypto.randomUUID();
  try { fs.writeFileSync(p, id); } catch { /* noop */ }
  return id;
}

// confirm 왕복 — id 상관. 앱이 죽으면(stdin close) 전 대기를 'no' 로 해소하고 종료.
let confirmSeq = 0;
const pendingConfirms = new Map(); // id -> resolve
function stdioConfirm(command, taskId, base) {
  return new Promise((resolve) => {
    const id = ++confirmSeq;
    pendingConfirms.set(id, resolve);
    send({ ev: 'confirm', id, command, taskId: taskId ?? null, base, sandbox: SANDBOX_ENABLED });
  });
}

let core = null;
let connection = null;
let folderRoot = null;

function connectFolder(folder) {
  if (!apiKey) { send({ ev: 'status', text: 'API key 필요 — 앱 설정에서 입력' }); return; }
  let real;
  try { real = fs.realpathSync(folder); } catch (e) { send({ ev: 'status', text: `폴더 열기 실패: ${e.message}` }); return; }
  if (connection) connection.disconnect();
  folderRoot = real;
  core = new BridgeCore({
    folder: folderRoot,
    confirm: stdioConfirm,
    sandboxProfileDir: SUPPORT_DIR,
    onTaskEnd: (taskId) => send({ ev: 'taskEnd', taskId: taskId ?? null }),
    onAutoApproveChange: () => send({ ev: 'autoApprove', count: core ? core.autoApprovedCount() : 0 }),
  });
  connection = new BridgeConnection({
    serverUrl,
    core,
    deviceId: deviceId(),
    label: `${os.hostname()} · ${path.basename(folderRoot)}`,
    headers: () => ({ Authorization: `Bearer ${apiKey}` }),
    onStatus: (s) => send({ ev: 'status', text: s }),
    shouldReconnect: () => !!folderRoot,
  });
  void connection.connect();
  send({ ev: 'connected', folder: folderRoot });
}

function disconnectFolder() {
  folderRoot = null;
  if (connection) connection.disconnect(); // 일괄 승인 회수 포함
  connection = null;
  core = null;
  send({ ev: 'status', text: '미연결' });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  switch (m.cmd) {
    case 'connect': if (typeof m.folder === 'string') connectFolder(m.folder); break;
    case 'disconnect': disconnectFolder(); break;
    case 'confirm': {
      const resolve = pendingConfirms.get(m.id);
      if (resolve) {
        pendingConfirms.delete(m.id);
        resolve(m.result === 'yes' || m.result === 'all' ? m.result : 'no');
      }
      break;
    }
    case 'clearAutoApprove': if (core) core.clearAutoApprove(); break;
    case 'quit': shutdown(); break;
    default: break;
  }
});

// 부모 앱 사망(stdin 종료) = 좀비 방지 최후 방어선 — 대기 confirm 전부 거부 후 종료.
// 거부 결과가 서버로 송신될 시간(microtask + WS flush)을 준 뒤 연결을 닫는다 —
// 즉시 exit 하면 서버는 거부 대신 요청 타임아웃을 겪는다.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const resolve of pendingConfirms.values()) resolve('no');
  pendingConfirms.clear();
  setTimeout(() => { disconnectFolder(); process.exit(0); }, 100);
}
rl.on('close', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

send({ ev: 'status', text: '미연결' });
