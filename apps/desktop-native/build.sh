#!/bin/bash
# OpenMake Companion 빌드 — 헬퍼 빌드(cargo) + 하네스 + Swift 빌드 + .app 조립 + ad-hoc 서명 + dmg.
# 사전: npm ci (하네스의 ws 패키지) + Rust 툴체인 (판은 apps/openmake-code/rust-toolchain.toml)
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

# 1) 헬퍼 빌드 (Rust omk-helper 릴리스 빌드 — 앱에 넣는 바로 그 실행 파일)
command -v cargo >/dev/null || { echo "Rust 툴체인이 없습니다 — rustup 설치 뒤 다시(판은 apps/openmake-code/rust-toolchain.toml)"; exit 1; }
(cd "$ROOT/apps/openmake-code" && cargo build --release --locked -p omk-helper)
HELPER_BIN="${CARGO_TARGET_DIR:-$ROOT/apps/openmake-code/target}/release/omk-helper"
[[ -x "$HELPER_BIN" ]] || { echo "omk-helper 실행 파일이 없습니다: $HELPER_BIN"; exit 1; }

# 2) 헬퍼 하네스 (회귀 게이트 — 번들에 넣는 릴리스 실행 파일로, 실패 시 빌드 중단)
test -d "$ROOT/node_modules/ws" || { echo "하네스의 ws 패키지 없음 — npm ci 먼저"; exit 1; }
(cd "$ROOT" && node apps/desktop-native/helper/harness.cjs --helper "$HELPER_BIN")

# 2-B) 다국어 표 게이트 (전 언어 키 집합·소스 사용 키 — 실패 시 빌드 중단)
bash check-l10n.sh

# 3) Swift 릴리스 빌드
(cd OpenMakeCompanion && swift build -c release)

# 4) .app 번들 조립
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp OpenMakeCompanion/.build/release/OpenMakeCompanion "$APP/Contents/MacOS/"
cp "$HELPER_BIN" "$APP/Contents/MacOS/omk-helper"
chmod +x "$APP/Contents/MacOS/omk-helper"
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
codesign --verify --deep --strict "$APP"

# 6) dmg (파일명은 서버 FILE_PATTERN ^OpenMake-[A-Za-z0-9.-]+\.dmg$ 준수)
DMG="$OUT/OpenMake-Companion-$VERSION-arm64.dmg"
rm -f "$DMG"
# hdiutil 은 GitHub macOS 실행기에서 "No space left on device" 로 간헐 실패한다(2026-10-05 하루 두 번, 디스크 여유와 무관 — 다시 돌리면 통과).
# 몇 번 다시 시도하고, 끝내 실패하면 빌드를 실패시킨다.
for attempt in 1 2 3; do
  hdiutil create -volname "$APP_NAME" -srcfolder "$APP" -ov -format UDZO "$DMG" >/dev/null && break
  [ "$attempt" = 3 ] && { echo "dmg 생성 실패(3회 시도)"; exit 1; }
  echo "dmg 생성 실패 — 다시 시도 ($attempt/3)"; rm -f "$DMG"; sleep 5
done
shasum -a 256 "$DMG"
echo "빌드 완료: $DMG"
