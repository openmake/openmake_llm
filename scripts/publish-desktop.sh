#!/bin/bash
# 데스크톱 dmg 를 업데이트 배포 디렉토리에 게시한다 (자체 업데이터용).
#   사용법: bash scripts/publish-desktop.sh [dmg경로]
#   기본:  apps/desktop/dist 의 최신 OpenMake-*.dmg
# 산출: $DESKTOP_UPDATE_DIR(기본 data/desktop-updates)/ 에 dmg 복사 + latest.json 생성.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${DESKTOP_UPDATE_DIR:-$ROOT/data/desktop-updates}"
DMG="${1:-$(ls -t "$ROOT"/apps/desktop/dist/OpenMake-*.dmg 2>/dev/null | head -1)}"
[ -f "$DMG" ] || { echo "dmg 없음: $DMG"; exit 1; }
FILE="$(basename "$DMG")"
VERSION="$(echo "$FILE" | sed -E 's/OpenMake-([0-9.]+)-.*/\1/')"
SHA=$(shasum -a 256 "$DMG" | awk '{print $1}')
mkdir -p "$DIR"
cp "$DMG" "$DIR/$FILE"
printf '{"version":"%s","file":"%s","sha256":"%s"}\n' "$VERSION" "$FILE" "$SHA" > "$DIR/latest.json"
echo "게시됨: v$VERSION → $DIR/$FILE"
cat "$DIR/latest.json"
