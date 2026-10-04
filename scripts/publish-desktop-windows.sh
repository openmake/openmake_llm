#!/usr/bin/env bash
# Windows Companion 설치 파일 게시 — latest.json 의 windows 블록만 갱신한다(macOS native 블록은 그대로 둔다).
#   기본:  apps/desktop-windows/release 의 최신 OpenMake-Companion-Setup-*.exe
# 산출: $DESKTOP_UPDATE_DIR(기본 data/desktop-updates)/ 에 설치 파일 복사 + latest.json({ windows }) 갱신.
# 앱은 GET /api/desktop/latest 의 windows 블록으로 새 버전을 확인하고, 받은 파일의 sha256 을 대조한 뒤에만 설치한다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${DESKTOP_UPDATE_DIR:-$ROOT/data/desktop-updates}"
EXE="${1:-$(ls -t "$ROOT"/apps/desktop-windows/release/OpenMake-Companion-Setup-*.exe 2>/dev/null | head -1)}"
[ -f "$EXE" ] || { echo "설치 파일 없음: $EXE"; exit 1; }
FILE="$(basename "$EXE")"
[[ "$FILE" =~ ^OpenMake-Companion-Setup-[A-Za-z0-9.-]+\.exe$ ]] || { echo "OpenMake-Companion-Setup-*.exe 만 게시할 수 있습니다: $FILE"; exit 1; }
VERSION="$(echo "$FILE" | sed -E 's/OpenMake-Companion-Setup-([0-9.]+)\.exe/\1/')"
SHA=$(shasum -a 256 "$EXE" | awk '{print $1}')
mkdir -p "$DIR"
cp "$EXE" "$DIR/$FILE"

VERSION="$VERSION" FILE="$FILE" SHA="$SHA" MANIFEST="$DIR/latest.json" node -e '
const fs = require("fs");
const { VERSION, FILE, SHA, MANIFEST } = process.env;
let prev = {};
try { prev = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { /* 첫 게시 */ }
fs.writeFileSync(MANIFEST, JSON.stringify({ ...(prev.native ? { native: prev.native } : {}), windows: { version: VERSION, file: FILE, sha256: SHA } }) + "\n");
'
echo "게시됨(windows): v$VERSION → $DIR/$FILE"
cat "$DIR/latest.json"
