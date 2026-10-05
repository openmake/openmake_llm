// 업데이트 확인 — 서버의 GET /api/desktop/latest 응답에서 Windows 블록을 읽어 새 버전인지 판정한다(순수 함수).
// 설치 파일은 받은 뒤 sha256 을 대조하고, 맞을 때만 실행한다(서명 없는 배포라 무결성 확인이 유일한 방어선이다).
import * as crypto from 'node:crypto';

const FILE_PATTERN = /^OpenMake-Companion-Setup-[A-Za-z0-9.-]+\.exe$/;

/** 'x.y.z' 비교 — a 가 크면 양수. 숫자가 아닌 구간은 0 으로 본다. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 응답(data)에서 설치할 Windows 업데이트를 고른다. 없거나, 현재보다 새 버전이 아니거나, 파일명·해시 형식이 어긋나면 null.
 * sha256 이 없는 블록은 받지 않는다 — 무결성을 확인할 수 없는 설치 파일은 실행하지 않는다.
 */
export function pickWindowsUpdate(data, currentVersion) {
  const w = data && typeof data === 'object' ? data.windows : null;
  if (!w || typeof w.version !== 'string' || typeof w.file !== 'string' || !FILE_PATTERN.test(w.file)) return null;
  if (typeof w.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(w.sha256)) return null;
  if (compareVersions(w.version, currentVersion) <= 0) return null;
  return { version: w.version, file: w.file, sha256: w.sha256.toLowerCase(), path: `/api/desktop/download/${w.file}` };
}

export function sha256Of(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
