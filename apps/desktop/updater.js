// 앱 업데이터 — 서버 매니페스트(GET /api/desktop/latest) 기반 자체 교체.
//
// 미서명(ad-hoc) 배포라 Squirrel/electron-updater 를 쓸 수 없어(서명 필수),
// dmg 를 받아 sha256 검증 후 분리 프로세스가 /Applications 교체 + 재실행한다.
// 흐름: 버전 비교 → 사용자 확인 다이얼로그 → 다운로드(tmp) → sha256 검증 →
//       교체 스크립트 spawn(detached) → 앱 종료 → 스크립트가 교체·xattr·재실행.
const { app, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CHECK_DELAY_MS = 5000;
// 매니페스트 파일명 화이트리스트 — 교체 스크립트에 문자열로 보간되므로 서버(config/
// desktop-update.ts)와 같은 패턴을 앱에서도 검증한다(백엔드 전환 가능 → 서버 검증만 의존 불가).
const FILE_PATTERN = /^OpenMake-[A-Za-z0-9.-]+\.dmg$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

// 업데이트는 미서명(ad-hoc) 교체라 무결성 신뢰가 전송 보안에 달려 있다. HTTPS 또는
// 루프백(로컬 백엔드)에서만 허용해 평문 HTTP MITM 으로 악성 dmg 가 주입되는 것을 막는다.
function isSecureUpdateOrigin(backendUrl) {
  try {
    const u = new URL(backendUrl);
    if (u.protocol === 'https:') return true;
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
  } catch { return false; }
}

/** "1.2.0" 형태 비교 — a > b 이면 양수. */
function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function fetchJson(url) {
  return fetch(url, { headers: { Accept: 'application/json' } }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

async function downloadTo(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`다운로드 실패 HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 현재 실행 중인 .app 번들 경로를 해석한다.
 *
 * 교체 대상을 `/Applications` 로 하드코딩하면 `~/Applications` 등 다른 위치에 설치한
 * 사용자에게서 조용히 어긋난다 — 교체는 엉뚱한 곳에 이뤄지고 원래 앱은 구버전으로
 * 남으며, 재실행 대상이 없어 앱이 다시 열리지 않는다. 실제 위치를 쓴다.
 *
 * @returns {string|null} .app 번들 절대경로 (패키징되지 않은 실행이면 null)
 */
function resolveAppBundlePath() {
  // /path/to/OpenMake.app/Contents/MacOS/OpenMake → /path/to/OpenMake.app
  const m = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(process.execPath);
  return m ? m[1] : null;
}

/**
 * 교체 가능 여부를 사전 점검한다. 앱을 종료한 뒤에는 사용자에게 알릴 수단이 없으므로
 * **종료 전에** 실패 조건을 걸러낸다.
 *
 * @returns {{ ok: true, appPath: string } | { ok: false, reason: string }}
 */
function checkReplaceable() {
  const appPath = resolveAppBundlePath();
  if (!appPath) {
    return { ok: false, reason: '패키징된 앱에서만 업데이트할 수 있습니다(개발 실행 중).' };
  }
  // dmg/외장 볼륨에서 바로 실행 중이면 교체해도 유실된다 — 설치 후 재시도하도록 안내.
  if (appPath.startsWith('/Volumes/')) {
    return {
      ok: false,
      reason: '디스크 이미지에서 실행 중입니다. 앱을 응용 프로그램 폴더로 옮긴 뒤 다시 시도하세요.',
    };
  }
  const parent = path.dirname(appPath);
  try {
    fs.accessSync(parent, fs.constants.W_OK);
  } catch {
    return {
      ok: false,
      reason: `설치 폴더에 쓸 권한이 없습니다: ${parent}\n관리자 계정으로 실행하거나, 앱을 사용자 폴더(~/Applications)로 옮긴 뒤 다시 시도하세요.`,
    };
  }
  return { ok: true, appPath };
}

/**
 * 교체 스크립트 — 앱 종료 후 dmg 마운트 → 실제 설치 경로 교체 → 격리 해제 → 재실행.
 *
 * 실패해도 사용자가 알 수 있어야 한다(기존에는 stdio 무시 + 오류 처리 없음이라
 * "앱이 종료됐는데 안 돌아온다" 로만 보였다):
 *   - 각 단계 실패 시 osascript 로 네이티브 경고를 띄우고 **원래 앱을 다시 연다**
 *   - 전 과정 로그를 파일로 남겨 사후 진단이 가능하게 한다
 */
function spawnReplaceScript(dmgPath, appPath) {
  const logPath = path.join(os.tmpdir(), `openmake-update-${Date.now()}.log`);
  const script = `#!/bin/bash
exec >>"${logPath}" 2>&1
set -u
APP="${appPath}"
DMG="${dmgPath}"

fail() {
  echo "FAIL: $1"
  # 앱이 이미 종료된 뒤라 Electron 다이얼로그를 쓸 수 없다 — 네이티브 경고로 알린다.
  /usr/bin/osascript -e "display alert \\"업데이트 실패\\" message \\"$1\\n\\n로그: ${logPath}\\" as critical" || true
  [ -d "$APP" ] && open -a "$APP" || true
  rm -f "$DMG"
  exit 1
}

sleep 2
# 마운트 경로 파싱: hdiutil 출력은 탭 구분이고 볼륨명에 공백이 있을 수 있다.
# 마지막 필드만 자르면(awk '{print $NF}') 공백에서 끊기므로 /Volumes 이후 전체를 취한다.
MNT=$(hdiutil attach -nobrowse "$DMG" | grep -o '/Volumes/.*' | tail -1)
[ -n "$MNT" ] || fail "디스크 이미지를 마운트하지 못했습니다."
[ -d "$MNT/OpenMake.app" ] || { hdiutil detach "$MNT" -quiet; fail "이미지 안에서 앱을 찾지 못했습니다."; }

# 교체는 임시 이름으로 먼저 복사한 뒤 스왑 — 도중 실패해도 기존 앱이 남는다.
STAGE="$APP.new"
rm -rf "$STAGE"
if ! ditto "$MNT/OpenMake.app" "$STAGE"; then
  rm -rf "$STAGE"; hdiutil detach "$MNT" -quiet
  fail "새 버전 복사에 실패했습니다(설치 폴더 권한을 확인하세요)."
fi
hdiutil detach "$MNT" -quiet

BACKUP="$APP.old"
rm -rf "$BACKUP"
mv "$APP" "$BACKUP" || { rm -rf "$STAGE"; fail "기존 앱을 교체할 수 없습니다."; }
if ! mv "$STAGE" "$APP"; then
  mv "$BACKUP" "$APP" 2>/dev/null   # 롤백
  fail "새 버전 설치에 실패해 이전 버전으로 되돌렸습니다."
fi
rm -rf "$BACKUP"

xattr -dr com.apple.quarantine "$APP" 2>/dev/null
rm -f "$DMG"
open -a "$APP" || fail "업데이트는 됐지만 앱을 다시 열지 못했습니다."
echo "OK: updated $APP"
rm -f "$0"
`;
  const sh = path.join(os.tmpdir(), `openmake-update-${Date.now()}.sh`);
  fs.writeFileSync(sh, script, { mode: 0o755 });
  spawn('/bin/bash', [sh], { detached: true, stdio: 'ignore' }).unref();
}

/**
 * 업데이트 확인. interactive=true(메뉴)면 "최신 버전" 안내도 표시,
 * false(기동 시 자동)면 새 버전 있을 때만 다이얼로그.
 */
async function checkForUpdate(backendUrl, win, interactive) {
  try {
    if (!isSecureUpdateOrigin(backendUrl)) {
      throw new Error('업데이트는 HTTPS(또는 로컬호스트) 백엔드에서만 허용됩니다');
    }
    const m = (await fetchJson(`${backendUrl}/api/desktop/latest`)).data;
    // sha256 은 필수 — 없으면(또는 형식 불량) 무결성 검증이 불가하므로 거부한다.
    if (!m || !m.version || !FILE_PATTERN.test(String(m.file)) || !SHA256_PATTERN.test(String(m.sha256 || ''))) {
      throw new Error('업데이트 매니페스트 형식이 올바르지 않습니다(version·file·sha256 확인)');
    }
    const current = app.getVersion();
    if (cmpVersion(m.version, current) <= 0) {
      if (interactive) {
        dialog.showMessageBox(win, { type: 'info', message: `최신 버전입니다 (v${current})` });
      }
      return;
    }
    const autoTest = process.env.OMK_UPDATE_AUTO === '1'; // 테스트 훅(개발 전용): 다이얼로그 생략
    const choice = autoTest ? 0 : dialog.showMessageBoxSync(win, {
      type: 'info',
      message: `새 버전 v${m.version} 이 있습니다 (현재 v${current})`,
      detail: '지금 업데이트하면 앱이 잠시 종료된 뒤 새 버전으로 다시 열립니다.',
      buttons: ['지금 업데이트', '나중에'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice !== 0) return;

    // 교체 가능 여부를 **다운로드 전에** 확인한다 — 앱을 종료한 뒤에는 알릴 수단이 없고,
    // 못 고칠 조건(권한·dmg 실행 등)이면 100MB 를 받는 것 자체가 낭비다.
    const pre = checkReplaceable();
    if (!pre.ok) throw new Error(pre.reason);

    const dmgPath = path.join(os.tmpdir(), m.file);
    const sha = await downloadTo(`${backendUrl}${m.url}`, dmgPath);
    if (sha.toLowerCase() !== String(m.sha256).toLowerCase()) {
      fs.rmSync(dmgPath, { force: true });
      throw new Error('다운로드 무결성 검증 실패(sha256 불일치)');
    }
    spawnReplaceScript(dmgPath, pre.appPath);
    app.quit();
  } catch (e) {
    if (interactive) {
      dialog.showMessageBox(win, {
        type: 'warning',
        message: '업데이트 확인 실패',
        detail: String(e.message || e),
      });
    }
    // 자동 확인 실패는 조용히 무시 (오프라인 등)
  }
}

module.exports = {
  checkForUpdate,
  /** 기동 시 자동 확인(지연 실행) — 새 버전 있을 때만 표시. */
  scheduleStartupCheck: (backendUrlFn, winFn) => {
    setTimeout(() => checkForUpdate(backendUrlFn(), winFn(), false), CHECK_DELAY_MS);
  },
  openReleasePage: (backendUrl) => shell.openExternal(backendUrl),
};
