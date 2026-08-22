#!/bin/bash
# 데스크톱 dmg 를 업데이트 배포 디렉토리에 게시한다 (자체 업데이터용).
#   사용법: bash scripts/publish-desktop.sh [dmg경로]
#   기본:  apps/desktop/dist 의 최신 OpenMake-*.dmg
# 산출: $DESKTOP_UPDATE_DIR(기본 data/desktop-updates)/ 에 dmg 복사 + latest.json 생성.
#
# native 채널(SwiftUI 컴패니언): 파일명이 OpenMake-Companion-* 이면 latest.json 의
# `native` 블록만 갱신한다 — Electron 필드(version/file/sha256)는 보존 (추가 전용 계약).
# 반대로 Electron dmg 게시 시에도 기존 native 블록을 보존한다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${DESKTOP_UPDATE_DIR:-$ROOT/data/desktop-updates}"
DMG="${1:-$(ls -t "$ROOT"/apps/desktop/dist/OpenMake-*.dmg 2>/dev/null | head -1)}"
[ -f "$DMG" ] || { echo "dmg 없음: $DMG"; exit 1; }
FILE="$(basename "$DMG")"
SHA=$(shasum -a 256 "$DMG" | awk '{print $1}')
mkdir -p "$DIR"
cp "$DMG" "$DIR/$FILE"

if [[ "$FILE" == OpenMake-Companion-* ]]; then
  VERSION="$(echo "$FILE" | sed -E 's/OpenMake-Companion-([0-9.]+)-.*/\1/')"
  CHANNEL=native
else
  VERSION="$(echo "$FILE" | sed -E 's/OpenMake-([0-9.]+)-.*/\1/')"
  CHANNEL=electron
fi

CHANNEL="$CHANNEL" VERSION="$VERSION" FILE="$FILE" SHA="$SHA" MANIFEST="$DIR/latest.json" node -e '
const fs = require("fs");
const { CHANNEL, VERSION, FILE, SHA, MANIFEST } = process.env;
let m = {};
try { m = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { /* 최초 생성 */ }
const entry = { version: VERSION, file: FILE, sha256: SHA };
if (CHANNEL === "native") m.native = entry;
else m = { ...entry, ...(m.native ? { native: m.native } : {}) };
fs.writeFileSync(MANIFEST, JSON.stringify(m) + "\n");
'
echo "게시됨($CHANNEL): v$VERSION → $DIR/$FILE"
cat "$DIR/latest.json"
