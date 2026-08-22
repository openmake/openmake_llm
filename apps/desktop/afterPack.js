// electron-builder afterPack 훅 — 미서명 배포용 deep ad-hoc 재서명.
// identity:null 은 서명을 통째로 건너뛰어 번들이 봉인되지 않은 깨진 상태로 남는다
// (codesign --verify 실패 → 수령자 Mac 에서 "손상되어 열 수 없습니다").
// dmg 패키징 직전(앱 pack 직후) 번들 전체를 ad-hoc 로 재서명해 Sealed Resources 를 채운다.
const { execFileSync } = require('child_process');
const path = require('path');
const asar = require('@electron/asar');

// asar 로컬 require 검증 — build.files 는 화이트리스트라 새 .js 모듈을 추가하고
// files 에 안 넣으면 dev 는 정상인데 패키징 앱만 기동 즉시 죽는다(v1.7.0 agent-browser.js
// 누락 사고: require throw → 창 미표시). 패키징된 각 .js 의 `require('./x')` 대상이
// asar 안에 실재하는지 빌드에서 검증해 같은 사고를 배포 전에 잡는다.
function assertLocalRequiresPacked(appPath) {
  const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  const entries = new Set(asar.listPackage(asarPath).map((p) => p.replace(/\\/g, '/')));
  for (const entry of [...entries].filter((p) => /^\/[^/]+\.js$/.test(p))) {
    const src = asar.extractFile(asarPath, entry.slice(1)).toString('utf8');
    for (const m of src.matchAll(/require\(\s*['"]\.\/([\w.-]+?)(?:\.js)?['"]\s*\)/g)) {
      // 파일 모듈(./x → /x.js) 또는 디렉토리 모듈(./x → /x/index.js — local-bridge-core
      // 복사본처럼 index.js 를 가진 디렉토리) 중 하나가 asar 에 있으면 통과.
      const file = `/${m[1]}.js`;
      const dirIndex = `/${m[1]}/index.js`;
      if (!entries.has(file) && !entries.has(dirIndex)) {
        throw new Error(`asar 누락 모듈: ${entry} 가 require 하는 ${file}(또는 ${dirIndex}) 가 패키징에 없음 — package.json build.files 에 추가하세요`);
      }
    }
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename; // OpenMake
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  assertLocalRequiresPacked(appPath);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
