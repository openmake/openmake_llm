#!/bin/bash
# 컴패니언 다국어 표 게이트 (build.sh·CI 공용) — 실패 시 빌드 중단.
#   ① 네 언어 .strings 문법  ② 키 집합 일치  ③ Swift 소스가 쓰는 L("키") 가 전부 표에 있음
# 빠진 키는 그 언어 사용자에게 식별자(menu.quit 등)가 그대로 보이므로 빌드 전에 막는다.
set -euo pipefail
cd "$(dirname "$0")"
L10N="Localization"

keys() {
  plutil -convert json -o - "$1" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Object.keys(JSON.parse(s)).sort().join("\n")))'
}

REF="$(keys "$L10N/ko.lproj/Localizable.strings")"
COUNT=0
for f in "$L10N"/*.lproj/Localizable.strings; do
  plutil -lint -s "$f" || { echo "문법 오류: $f"; exit 1; }
  if [ "$(keys "$f")" != "$REF" ]; then
    echo "키 불일치 (ko 기준): $f"
    diff <(echo "$REF") <(keys "$f") || true
    exit 1
  fi
  COUNT=$((COUNT + 1))
done

USED="$(grep -rhoE '\bL\("[A-Za-z0-9._]+"' OpenMakeCompanion/Sources | sed -E 's/^L\("//; s/"$//' | sort -u)"
MISSING="$(comm -23 <(echo "$USED") <(echo "$REF"))"
if [ -n "$MISSING" ]; then
  echo "소스가 쓰지만 표에 없는 키:"
  echo "$MISSING"
  exit 1
fi
echo "l10n OK — 키 $(echo "$REF" | wc -l | tr -d ' ')개 × 언어 ${COUNT}개"
