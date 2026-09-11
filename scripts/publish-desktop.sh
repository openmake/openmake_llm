#!/bin/bash
# macOS 컴패니언 dmg 를 업데이트 배포 디렉토리에 게시한다 (자체 업데이터용).
#   사용법: bash scripts/publish-desktop.sh [dmg경로]
#   기본:  apps/desktop-native/dist 의 최신 OpenMake-Companion-*.dmg
# 산출: $DESKTOP_UPDATE_DIR(기본 data/desktop-updates)/ 에 dmg 복사 + latest.json({ native }) 갱신.
#
# macOS 는 네이티브 컴패니언만 배포한다(2026-09-11) — 구 Electron 채널은 게시·매니페스트·
# 다운로드에서 모두 제거됐으므로 컴패니언이 아닌 dmg 는 거부한다. 매니페스트는 native 블록
# 하나로 다시 쓴다(남아 있던 Electron 최상위 필드도 이때 사라진다). 파일명 규칙은 서버
# config/desktop-update.ts 의 FILE_PATTERN 과 같다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${DESKTOP_UPDATE_DIR:-$ROOT/data/desktop-updates}"
DMG="${1:-$(ls -t "$ROOT"/apps/desktop-native/dist/OpenMake-Companion-*.dmg 2>/dev/null | head -1)}"
[ -f "$DMG" ] || { echo "dmg 없음: $DMG"; exit 1; }
FILE="$(basename "$DMG")"
[[ "$FILE" =~ ^OpenMake-Companion-[A-Za-z0-9.-]+\.dmg$ ]] || { echo "컴패니언 dmg(OpenMake-Companion-*.dmg)만 게시할 수 있습니다: $FILE"; exit 1; }
VERSION="$(echo "$FILE" | sed -E 's/OpenMake-Companion-([0-9.]+)-.*/\1/')"
SHA=$(shasum -a 256 "$DMG" | awk '{print $1}')
mkdir -p "$DIR"
cp "$DMG" "$DIR/$FILE"

VERSION="$VERSION" FILE="$FILE" SHA="$SHA" MANIFEST="$DIR/latest.json" node -e '
const fs = require("fs");
const { VERSION, FILE, SHA, MANIFEST } = process.env;
fs.writeFileSync(MANIFEST, JSON.stringify({ native: { version: VERSION, file: FILE, sha256: SHA } }) + "\n");
'
echo "게시됨(native): v$VERSION → $DIR/$FILE"
cat "$DIR/latest.json"
