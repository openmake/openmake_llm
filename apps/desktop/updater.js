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

/** 교체 스크립트 — 앱 종료 후 dmg 마운트 → /Applications 교체 → 격리 해제 → 재실행. */
function spawnReplaceScript(dmgPath) {
  const script = `#!/bin/bash
sleep 2
MNT=$(hdiutil attach -nobrowse "${dmgPath}" | tail -1 | awk '{print $NF}')
if [ -d "$MNT/OpenMake.app" ]; then
  rm -rf /Applications/OpenMake.app
  ditto "$MNT/OpenMake.app" /Applications/OpenMake.app
  xattr -dr com.apple.quarantine /Applications/OpenMake.app 2>/dev/null
fi
hdiutil detach "$MNT" -quiet
rm -f "${dmgPath}"
open -a /Applications/OpenMake.app
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

    const dmgPath = path.join(os.tmpdir(), m.file);
    const sha = await downloadTo(`${backendUrl}${m.url}`, dmgPath);
    if (sha.toLowerCase() !== String(m.sha256).toLowerCase()) {
      fs.rmSync(dmgPath, { force: true });
      throw new Error('다운로드 무결성 검증 실패(sha256 불일치)');
    }
    spawnReplaceScript(dmgPath);
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
