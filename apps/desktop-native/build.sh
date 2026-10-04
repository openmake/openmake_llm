#!/bin/bash
# OpenMake Companion 빌드 — 헬퍼 번들 + Swift 빌드 + .app 조립 + ad-hoc 서명 + dmg.
# 사전: npm run build:packages (local-bridge-core dist 필요)
# 사용: bash apps/desktop-native/build.sh [버전]   (기본 버전: VERSION 파일)
# 버전을 주지 않으면 VERSION 파일의 값을 쓴다 — 종전 기본값 0.1.0 은 서버에 게시된 버전(0.2.8)보다 낮아,
# CI 가 만든 새 빌드가 게시본을 "새 버전"으로 보고 구버전으로 되돌아갔다(2026-10-05).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
VERSION="${1:-$(tr -d '[:space:]' < VERSION)}"
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+)*$ ]] || { echo "버전 형식이 잘못됐습니다: $VERSION"; exit 1; }
APP_NAME="OpenMake Companion"
BUNDLE_ID="cc.openmake.companion"
OUT="dist"
APP="$OUT/$APP_NAME.app"

# 1) 헬퍼 번들 (코어 재사용 — 보안 코드 재구현 금지 원칙)
test -f "$ROOT/packages/local-bridge-core/dist/index.js" || { echo "core dist 없음 — npm run build:packages 먼저"; exit 1; }
(cd "$ROOT" && npx esbuild apps/desktop-native/helper/src/helper.mjs --bundle --platform=node \
  --target=node20 --format=cjs --outfile=apps/desktop-native/helper/dist/helper.cjs)

# 2) 헬퍼 하네스 (회귀 게이트 — 실패 시 빌드 중단)
(cd "$ROOT" && node apps/desktop-native/helper/harness.cjs)

# 2-B) 다국어 표 게이트 (전 언어 키 집합·소스 사용 키 — 실패 시 빌드 중단)
bash check-l10n.sh

# 3) Swift 릴리스 빌드
(cd OpenMakeCompanion && swift build -c release)

# 4) .app 번들 조립
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp OpenMakeCompanion/.build/release/OpenMakeCompanion "$APP/Contents/MacOS/"
cp helper/dist/helper.cjs "$APP/Contents/Resources/helper.cjs"
# Node 런타임 동봉 — 시스템 node 미의존 (plan Step 0 결정)
NODE_BIN="$(command -v node)"
NODE_BIN="$(node -e 'console.log(process.execPath)')"
cp "$NODE_BIN" "$APP/Contents/Resources/node"
chmod +x "$APP/Contents/Resources/node"
# 앱 아이콘 — 구 Electron 앱에서 이설한 자산 (2026-08-23, apps/desktop 제거)
cp "$ROOT/apps/desktop-native/assets/icon.icns" "$APP/Contents/Resources/icon.icns"
# 다국어 표 — ko(개발 언어)·en·ja·zh-Hans·de (웹 LOCALES 와 같은 언어)
cp -R Localization/*.lproj "$APP/Contents/Resources/"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleExecutable</key><string>OpenMakeCompanion</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleDevelopmentRegion</key><string>ko</string>
  <key>CFBundleLocalizations</key><array><string>ko</string><string>en</string><string>ja</string><string>zh-Hans</string><string>de</string></array>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>NSHumanReadableCopyright</key><string>OpenMake</string>
</dict></plist>
PLIST

# 5) ad-hoc 서명 (기존 Electron dmg 관행 — sha256 매니페스트로 무결성 검증)
codesign --force --deep --sign - "$APP"

# 6) dmg (파일명은 서버 FILE_PATTERN ^OpenMake-[A-Za-z0-9.-]+\.dmg$ 준수)
DMG="$OUT/OpenMake-Companion-$VERSION-arm64.dmg"
rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$APP" -ov -format UDZO "$DMG" >/dev/null
shasum -a 256 "$DMG"
echo "빌드 완료: $DMG"
