// electron-builder afterPack 훅 — 미서명 배포용 deep ad-hoc 재서명.
// identity:null 은 서명을 통째로 건너뛰어 번들이 봉인되지 않은 깨진 상태로 남는다
// (codesign --verify 실패 → 수령자 Mac 에서 "손상되어 열 수 없습니다").
// dmg 패키징 직전(앱 pack 직후) 번들 전체를 ad-hoc 로 재서명해 Sealed Resources 를 채운다.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename; // OpenMake
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
