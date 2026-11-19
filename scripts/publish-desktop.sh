#!/bin/bash
# macOS 앱 dmg 를 업데이트 배포 디렉토리에 게시한다 (자체 업데이터용).
#   사용법: bash scripts/publish-desktop.sh [dmg경로]
#   기본:  apps/desktop-native/dist 의 최신 OpenMake-Code-*.dmg (main 은 새 앱만 빌드한다 — 다리 dmg 는 재발행 가지의 스크립트로)
# 산출: $DESKTOP_UPDATE_DIR(기본 data/desktop-updates)/ 에 dmg 복사 + latest.json 의 블록 하나 갱신.
#
# 블록은 파일명 접두로 고른다 — OpenMake-Companion-*.dmg → native(옛 정체성), OpenMake-Code-*.dmg → macos(새 정체성).
# 그 밖의 dmg(구 Electron 등)는 거부한다. 파일명 규칙은 서버 config/desktop-update.ts 의 FILE_PATTERN·MACOS_FILE_PATTERN 과
# 글자 그대로 같다(라우트 테스트가 대조한다). 매니페스트의 다른 블록(값이 객체인 최상위 키 — macos·native·windows 등)은
# 남기고, 값이 객체가 아닌 최상위 키(구 Electron 의 version·file·sha256)는 버린다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${DESKTOP_UPDATE_DIR:-$ROOT/data/desktop-updates}"
DMG="${1:-$(ls -t "$ROOT"/apps/desktop-native/dist/OpenMake-Code-*.dmg 2>/dev/null | head -1)}"
[ -f "$DMG" ] || { echo "dmg 없음: $DMG"; exit 1; }
FILE="$(basename "$DMG")"
if [[ "$FILE" =~ ^OpenMake-Companion-[A-Za-z0-9.-]+\.dmg$ ]]; then
  BLOCK=native
elif [[ "$FILE" =~ ^OpenMake-Code-[A-Za-z0-9.-]+\.dmg$ ]]; then
  BLOCK=macos
else
  echo "macOS 앱 dmg(OpenMake-Companion-*.dmg·OpenMake-Code-*.dmg)만 게시할 수 있습니다: $FILE"; exit 1
fi
VERSION="$(echo "$FILE" | sed -E 's/^OpenMake-(Companion|Code)-([0-9.]+)-.*/\2/')"
SHA=$(shasum -a 256 "$DMG" | awk '{print $1}')
mkdir -p "$DIR"
cp "$DMG" "$DIR/$FILE"

BLOCK="$BLOCK" VERSION="$VERSION" FILE="$FILE" SHA="$SHA" MANIFEST="$DIR/latest.json" node -e '
const fs = require("fs");
const { BLOCK, VERSION, FILE, SHA, MANIFEST } = process.env;
// 다른 블록(값이 객체인 최상위 키)은 남긴다 — 한 OS·정체성의 게시가 다른 배포 정보를 지우지 않게.
let prev = {};
try { prev = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { /* 첫 게시 */ }
const next = {};
for (const [key, value] of Object.entries(prev && typeof prev === "object" ? prev : {})) if (value && typeof value === "object" && !Array.isArray(value)) next[key] = value;
next[BLOCK] = { version: VERSION, file: FILE, sha256: SHA };
fs.writeFileSync(MANIFEST, JSON.stringify(next) + "\n");
'
echo "게시됨($BLOCK): v$VERSION → $DIR/$FILE"
cat "$DIR/latest.json"
