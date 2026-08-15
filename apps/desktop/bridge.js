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
//    ② 나머지는 실행 전 사용자 확인(confirmExec) — 서버 승인 설정과 무관한 비우회 게이트.
//       사용자가 원하면 **그 작업 동안만** 일괄 승인할 수 있고(작업 종료·연결 해제 시 회수),
//       서버가 임의로 켤 수는 없다(선택 주체가 항상 사용자)
//    ③ 승인된 명령도 OS 샌드박스(sandbox-exec)로 감싸 폴더 밖 쓰기·비밀 읽기를 커널이 차단
//    (읽기 일반·네트워크는 허용 — 개발 명령 호환. 막는 축은 '파괴'와 '비밀 유출')
//  - 인증은 앱 세션의 auth_token 쿠키 재사용 (토큰을 디스크에 저장하지 않음)
const { session, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const crypto = require('crypto');
const WebSocket = require('ws');
const agentBrowser = require('./agent-browser');

const EXEC_TIMEOUT_MS = 120000;
const MAX_BUFFER = 1024 * 1024;
const RECONNECT_MS = 10000;
const PATH_PROBE_TIMEOUT_MS = 5000;

// ── exec PATH 보강 ───────────────────────────────────────────────────────
// Finder 기동 GUI 앱은 로그인 셸 PATH 를 물려받지 못해 mise/Homebrew 런타임(node·npm 등)을
// 못 찾는다 (2026-08-15 실측: 최소 PATH 에서 `node: command not found`). ① 로그인 셸 PATH
// 캡처 ② mise 도구 경로(activate 가 zshrc 전용이라 ①에도 안 잡힘 — bin-paths 직접 조회,
// cwd=연결 폴더라 프로젝트 버전 반영) ③ 표준 설치 경로 폴백을 병합한다. 폴더 연결 시 1회
// 계산하고, 각 단계 실패는 다음 폴백으로 넘어간다(exec 자체를 막지 않음).
let execPathCache = null;
function resolveExecPath() {
  if (execPathCache) return execPathCache;
  const parts = [];
  try {
    parts.push(...execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', 'echo -n "$PATH"'],
      { encoding: 'utf8', timeout: PATH_PROBE_TIMEOUT_MS }).trim().split(':'));
  } catch { /* 로그인 셸 실패 → 아래 폴백만 사용 */ }
  parts.push(...(process.env.PATH || '').split(':'));
  parts.push('/opt/homebrew/bin', '/usr/local/bin',
    path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.local/share/mise/shims'));
  const base = [...new Set(parts.filter(Boolean))].join(':');
  let merged = base;
  try {
    const misePaths = execFileSync('mise', ['bin-paths'],
      { encoding: 'utf8', timeout: PATH_PROBE_TIMEOUT_MS, cwd: folderRoot || os.homedir(), env: { ...process.env, PATH: base } })
      .trim().split('\n').filter(Boolean);
    // 프로젝트 버전이 이기도록 mise 경로를 앞에 둔다.
    merged = [...new Set([...misePaths, ...base.split(':')])].join(':');
  } catch { /* mise 부재/미신뢰 설정 — base 만 사용 */ }
  execPathCache = merged;
  return execPathCache;
}

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

/**
 * 작업 단위 일괄 승인 — 사용자가 "이 작업 동안 모두 실행"을 고른 taskId 집합.
 *
 * 에이전트 작업 하나가 셸 명령을 수십 번 부르므로 매번 묻는 것은 실사용이 어렵다(2026-08-09
 * GUI 검증에서 확인). 범위를 **그 작업으로 한정**해 다른 작업까지 열리지 않게 하고, 작업 종료
 * (task_end)·폴더 연결 해제 시 즉시 비운다. 나머지 방어(EXEC_DENYLIST hard-block, OS
 * 샌드박스의 폴더 밖 쓰기·비밀 읽기 차단)는 자동 승인이어도 그대로 적용된다.
 */
const autoApproveTasks = new Set();

/** exec 실행 전 사용자 확인(비우회). 거부/취소면 false. 실행될 명령 원문을 그대로 보여준다. */
async function confirmExec(command, taskId) {
  // 테스트 훅(개발/E2E 전용): 다이얼로그 없이 자동 승인 (다른 OMK_BRIDGE_* 훅과 동일 계열).
  if (process.env.OMK_BRIDGE_AUTO_APPROVE === '1') return true;
  if (taskId && autoApproveTasks.has(taskId)) return true;
  const preview = command.length > 800 ? command.slice(0, 800) + '…' : command;
  const r = await dialog.showMessageBox(mainWin || undefined, {
    type: 'warning',
    message: '에이전트가 이 셸 명령을 당신의 컴퓨터에서 실행하려고 합니다',
    detail: `${preview}\n\n연결 폴더: ${folderRoot}\n${SANDBOX_ENABLED && sandboxProfilePath
      ? 'OS 샌드박스 적용: 폴더 밖 쓰기와 비밀 파일(.ssh/.aws 등) 읽기는 차단됩니다. 그 외 읽기·네트워크는 허용됩니다.'
      : '⚠️ 샌드박스 미적용: 이 명령은 당신 계정 권한으로 폴더 밖 파일·네트워크에 접근할 수 있습니다.'}${
      taskId ? '\n\n"이 작업 동안 모두 실행"을 고르면 이 작업이 끝날 때까지 다시 묻지 않습니다(다른 작업에는 적용되지 않습니다).' : ''}`,
    buttons: taskId ? ['실행', '이 작업 동안 모두 실행', '거부'] : ['실행', '거부'],
    defaultId: taskId ? 2 : 1,
    cancelId: taskId ? 2 : 1,
    noLink: true,
  });
  if (taskId && r.response === 1) { autoApproveTasks.add(taskId); buildMenuHook(); return true; }
  return r.response === 0;
}

/** 메뉴 라벨(자동 승인 중 표시) 갱신 훅 — main.js 가 setOnStatusChange 로 주입한 콜백 재사용. */
function buildMenuHook() { try { onStatusChange(statusText); } catch { /* noop */ } }

/** 현재 일괄 승인 중인 작업 수 — 메뉴 표시용(사용자가 상태를 인지할 수 있게). */
function autoApprovedCount() { return autoApproveTasks.size; }

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
/**
 * 연결 폴더가 git 레포(하위 폴더 포함)면 레포의 .git 절대경로, 아니면 null.
 * 레포 **하위 폴더**를 연결하면 .git 이 폴더 밖에 있어 샌드박스가 git 쓰기를 막았다 —
 * 레포 루트를 연결했을 때는 이미 허용되던 쓰기라, 허용해도 권한이 새로 넓어지지 않는다
 * (같은 레포인데 연결 지점에 따라 동작이 갈리던 비일관성 해소. worktree 커밋의 index.lock 이
 * `.git/worktrees/<name>/` 에 생겨 2026-08-09 GUI 검증에서 실제 실패로 드러났다).
 */
function detectGitDir(root) {
  try {
    const out = execFileSync('git', ['rev-parse', '--absolute-git-dir'],
      { cwd: root, encoding: 'utf8', timeout: 5000 }).trim();
    return out || null;
  } catch { return null; }
}

function writeSandboxProfile(app, root, gitDir) {
    try {
        const home = fs.realpathSync(os.homedir());
        const sub = (base, list) => list.map((d) => `(subpath ${sbq(path.join(base, d))})`).join(' ');
        const profile = [
            '(version 1)',
            '(allow default)',
            '(deny file-write*)',
            `(allow file-write* (subpath ${sbq(root)}))`,
            // 레포 하위 폴더 연결 시 .git 은 폴더 밖 — git(커밋·인덱스) 쓰기를 열어준다(위 detectGitDir 주석).
            ...(gitDir ? [`(allow file-write* (subpath ${sbq(gitDir)}))`] : []),
            '(allow file-write* (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/dev"))',
            `(allow file-write* ${sub(home, CACHE_SUBPATHS)})`,
            `(deny file-read* ${sub(home, SECRET_SUBPATHS)})`,
            // 훅·config 는 커밋에 불필요하면서 영구 코드주입 벡터다 — 에이전트가 .git/hooks 나
            // core.hooksPath 를 심으면 사용자가 나중에 git 을 쓸 때 **샌드박스 밖에서** 실행된다.
            // SBPL 은 last-match-wins 라 이 deny 를 **프로파일 맨 끝**에 둔다(레포가 상위 allow
            // 경로 안에 있어도 확실히 이기도록 — /private/tmp 아래 레포로 실측 검증).
            // identity 설정이 필요하면 `git -c user.email=...` 인라인을 쓰면 된다.
            ...(gitDir ? [`(deny file-write* (subpath ${sbq(path.join(gitDir, 'hooks'))}) (literal ${sbq(path.join(gitDir, 'config'))}))`] : []),
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

// ── worktree 격리 (로컬 실행기) ──────────────────────────────────────────
// 에이전트가 사용자의 현재 작업트리·브랜치를 직접 건드리지 않도록, 연결 폴더가 git 레포면
// 별도 worktree(=별도 디렉토리 + 별도 브랜치)를 만들어 그 안에서만 작업하게 한다.
//
// 왜 연결 폴더 '안'인가: exec 는 sandbox-exec 로 폴더 밖 쓰기가 커널 차단되고, 파일 kind 는
// safe() 스코프에 걸린다. 폴더 밖에 만들면 두 방어에 모두 막혀 아무것도 못 한다.
// 대신 .git/info/exclude 에 등록해 사용자의 git status·.gitignore 를 오염시키지 않는다.
//
// git 명령은 **서버 문자열을 쓰지 않고 여기서 인자 배열로 조립**한다(명령 주입 차단).
// 그래서 confirmExec(사용자 확인) 없이 수행해도 안전하다 — 실행 대상이 고정된 git 연산뿐이다.
const WORKTREE_DIR = '.openmake/worktrees';
const WORKTREE_BRANCH_PREFIX = 'omk-task/';
/** taskId 재검증 — 경로·브랜치명에 들어가므로 UUID 문자만 허용(디렉토리 탈출·옵션 주입 차단). */
const TASK_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

function git(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** 연결 폴더가 git 작업트리인지. worktree 안에서 재연결한 경우도 정상 동작한다. */
async function isGitRepo() {
  const r = await git(['rev-parse', '--is-inside-work-tree'], folderRoot);
  return r.code === 0 && r.stdout.trim() === 'true';
}

/** worktree 디렉토리를 로컬 전용 제외 목록에 등록 — 사용자의 .gitignore 는 건드리지 않는다. */
function excludeWorktreeDir(gitDir) {
  try {
    const infoDir = path.join(gitDir, 'info');
    fs.mkdirSync(infoDir, { recursive: true });
    const p = path.join(infoDir, 'exclude');
    const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    if (!cur.split('\n').some((l) => l.trim() === '.openmake/')) {
      fs.appendFileSync(p, `${cur.endsWith('\n') || cur === '' ? '' : '\n'}.openmake/\n`);
    }
  } catch { /* 제외 등록 실패는 치명적이지 않다(사용자 status 에 보일 뿐) */ }
}

/**
 * diff 기준점(worktree 생성 시점 커밋) 저장·조회.
 *
 * worktree 메타 디렉토리(`.git/worktrees/<name>/`)에 둔다 — 작업트리 밖이라 diff·status 에
 * 잡히지 않고, `git worktree remove` 시 함께 정리된다. 읽기 실패 시 'HEAD' 로 폴백한다
 * (커밋이 있었다면 그 변경은 놓치지만, diff 캡처 자체가 죽지는 않는다).
 */
async function worktreeMetaDir(wtAbs) {
  const r = await git(['rev-parse', '--absolute-git-dir'], wtAbs);
  return r.code === 0 ? r.stdout.trim() : null;
}

async function writeBaseSha(wtAbs) {
  try {
    const meta = await worktreeMetaDir(wtAbs);
    const head = await git(['rev-parse', 'HEAD'], wtAbs);
    if (meta && head.code === 0) fs.writeFileSync(path.join(meta, 'omk-base'), head.stdout.trim());
  } catch { /* 기준점 기록 실패는 치명적이지 않다(HEAD 폴백) */ }
}

async function readBaseSha(wtAbs) {
  try {
    const meta = await worktreeMetaDir(wtAbs);
    const p = meta && path.join(meta, 'omk-base');
    if (p && fs.existsSync(p)) {
      const sha = fs.readFileSync(p, 'utf8').trim();
      if (/^[0-9a-f]{7,40}$/.test(sha)) return sha;
    }
  } catch { /* noop */ }
  return 'HEAD';
}

async function handleWorktree(m, done) {
  if (!folderRoot) { done({ ok: false, error: '폴더가 연결되지 않았습니다' }); return; }
  const taskId = String(m.taskId || '');
  if (!TASK_ID_RE.test(taskId)) { done({ ok: false, error: '잘못된 taskId 형식' }); return; }
  const rel = `${WORKTREE_DIR}/${taskId}`;
  const abs = path.join(folderRoot, rel);
  const branch = `${WORKTREE_BRANCH_PREFIX}${taskId.slice(0, 8)}`;

  if (m.op === 'add') {
    if (!(await isGitRepo())) { done({ ok: false, error: 'git 레포가 아닙니다' }); return; }
    // worktree 는 **레포 전체**를 체크아웃한다. 연결 폴더가 레포 루트가 아니라 하위 디렉토리면
    // (예: 레포 /repo 를 두고 /repo/apps/web 을 연결) worktree 루트는 /repo 에 대응하므로,
    // 에이전트의 상대경로가 그대로면 다른 위치를 가리킨다. show-prefix 만큼 더 내려가 맞춘다.
    const prefixR = await git(['rev-parse', '--show-prefix'], folderRoot);
    const sub = prefixR.code === 0 ? prefixR.stdout.trim().replace(/\/+$/, '') : '';
    const workRel = sub ? `${rel}/${sub}` : rel;
    const gitDirR = await git(['rev-parse', '--absolute-git-dir'], folderRoot);
    if (gitDirR.code === 0) excludeWorktreeDir(gitDirR.stdout.trim());
    if (fs.existsSync(abs)) { done({ ok: true, worktreeRel: workRel, branch }); return; } // 재개 시 재사용
    const r = await git(['worktree', 'add', abs, '-b', branch], folderRoot);
    if (r.code !== 0) { done({ ok: false, error: `worktree 생성 실패: ${(r.stderr || r.stdout).trim().slice(0, 300)}` }); return; }
    await writeBaseSha(abs);
    done({ ok: true, worktreeRel: workRel, branch });
    return;
  }

  if (m.op === 'diff') {
    if (!fs.existsSync(abs)) { done({ ok: false, error: 'worktree 없음' }); return; }
    // -N: 새 파일을 인덱스에 '의도만' 등록해 diff 에 포함시킨다(실제 스테이징·커밋은 하지 않음).
    await git(['add', '-A', '-N', '.'], abs);
    // 기준점은 **worktree 생성 시점의 커밋**이다. HEAD 를 쓰면 에이전트가 중간에 커밋했을 때
    // 그 변경이 diff 에서 사라진다(2026-08-09 라이브 E2E 에서 실제 발생 — 모델이 작업을 커밋해
    // diff 에 마지막 미커밋 파일 하나만 남았다).
    const r = await git(['diff', await readBaseSha(abs)], abs);
    if (r.code !== 0) { done({ ok: false, error: `diff 실패: ${(r.stderr || '').trim().slice(0, 200)}` }); return; }
    done({ ok: true, stdout: r.stdout, branch });
    return;
  }

  if (m.op === 'remove') {
    if (!fs.existsSync(abs)) { done({ ok: true, kept: false }); return; }
    // 변경분이 남아 있으면 **지우지 않는다** — 사용자 디스크의 작업 결과를 임의 삭제하지 않는다.
    // 미커밋 변경뿐 아니라 **에이전트가 만든 커밋**도 보존 대상이다(HEAD 가 기준점에서 움직였는지).
    const st = await git(['status', '--porcelain'], abs);
    const head = await git(['rev-parse', 'HEAD'], abs);
    const moved = head.code === 0 && head.stdout.trim() !== (await readBaseSha(abs));
    if ((st.code === 0 && st.stdout.trim() !== '') || moved) { done({ ok: true, kept: true, branch }); return; }
    const r = await git(['worktree', 'remove', '--force', abs], folderRoot);
    if (r.code !== 0) { done({ ok: true, kept: true, branch }); return; } // 제거 실패도 보존으로 취급
    await git(['branch', '-D', branch], folderRoot); // 변경 없는 빈 브랜치 정리(실패 무시)
    done({ ok: true, kept: false, branch });
    return;
  }

  done({ ok: false, error: `지원하지 않는 worktree op: ${m.op}` });
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
      // ② 나머지는 실행 전 사용자 확인 (비우회). 같은 작업 안에서는 사용자가 일괄 승인할 수 있다.
      if (!(await confirmExec(String(m.command || ''), m.taskId))) {
        done({ ok: false, error: '사용자가 명령 실행을 거부했습니다', exitCode: 126 }); return;
      }
      // ③ OS 샌드박스로 감싸 실행 — 폴더 밖 쓰기·비밀 읽기를 커널이 차단한다.
      //    프로파일 준비 실패 시 fail-closed(비격리 실행 거부). 해제는 OMK_BRIDGE_SANDBOX=0.
      if (SANDBOX_ENABLED && !sandboxProfilePath) {
        done({ ok: false, error: 'exec 샌드박스 프로파일을 준비하지 못해 실행을 거부했습니다(폴더 재연결 필요). 비격리 실행이 필요하면 OMK_BRIDGE_SANDBOX=0 으로 앱을 실행하세요.', exitCode: 126 });
        return;
      }
      const opts = { cwd: folderRoot, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: { ...process.env, PATH: resolveExecPath() } };
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
    case 'worktree':
      await handleWorktree(m, done); return;
    case 'task_end':
      agentBrowser.closeAll();   // 작업 종료 시 브라우저 패널 정리
      // 일괄 승인은 그 작업에만 유효 — 종료 즉시 회수한다.
      if (m.taskId && autoApproveTasks.delete(m.taskId)) buildMenuHook();
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
  execPathCache = null; // 폴더가 바뀌면 mise 프로젝트 버전도 바뀔 수 있다 — PATH 재계산.
  // 연결 폴더 기준으로 exec 샌드박스 프로파일 갱신 (폴더가 바뀌면 스코프도 바뀐다).
  sandboxProfilePath = SANDBOX_ENABLED ? writeSandboxProfile(app, folderRoot, detectGitDir(folderRoot)) : null;
  await connect(app, backendUrl);
}

function disconnectFolder() {
  folderRoot = null;
  clearTimeout(reconnectTimer);
  clearInterval(refreshTimer);
  autoApproveTasks.clear();   // 연결이 끊기면 일괄 승인도 회수한다(다음 연결로 새지 않게).
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
  /** 일괄 승인 중인 작업 수 — 메뉴에 노출해 사용자가 상태를 인지하게 한다. */
  autoApprovedCount,
  /** 일괄 승인 전체 해제 — 메뉴에서 즉시 회수할 수 있어야 한다. */
  clearAutoApprove: () => { autoApproveTasks.clear(); buildMenuHook(); },
  setOnStatusChange: (fn) => { onStatusChange = fn; },
  /** 백엔드 전환 시 재연결 */
  onBackendChanged: (app, backendUrl) => { if (folderRoot) connect(app, backendUrl); },
};
