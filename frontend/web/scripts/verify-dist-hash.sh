#!/usr/bin/env bash
# ============================================================
# verify-dist-hash.sh — Vite content-hash 빌드 산출물 회귀 검증
# ============================================================
# 캐시 버스터 회귀 방지: dist/index.html 이 반드시 content-hash asset 만 참조하고,
# 옛 방식(직접 ESM 파일 / ?v= 쿼리)으로 되돌아가지 않았는지 빌드 시 자동 차단한다.
set -euo pipefail

DIST="$(cd "$(dirname "$0")/.." && pwd)/dist"
INDEX="$DIST/index.html"

if [ ! -f "$INDEX" ]; then
  echo "[verify-dist-hash] FAIL: $INDEX 가 없습니다 (vite build 미실행?)." >&2
  exit 1
fi

# 1) index.html 이 hash 없는 직접 JS/CSS(`js/main.js`, `js/modules/...`) 또는 `?v=` 캐시버스터
#    쿼리를 script src / link href 어디서든 참조하면 실패. Vite entry 는 /assets/<name>.<hash>.*
#    만 참조해야 한다. (vendor/ 직접 script·link 는 hash 없이 허용 — ?v= 만 없으면 OK)
if grep -nE '(src|href)="[^"]*\?v=|src="/?js/main\.js|src="/?js/modules/|src="/?js/spa-router\.js' "$INDEX"; then
  echo "[verify-dist-hash] FAIL: index.html 이 hash 없는 직접 JS / ?v= 캐시버스터 쿼리(script src 또는 link href)를 참조합니다." >&2
  echo "  → Vite 번들(/assets/*.<hash>.{js,css}) 만 참조해야 합니다." >&2
  exit 1
fi

# 2) dist/assets 에 content-hash JS 가 실제로 생성됐는지.
if ! ls "$DIST"/assets/*.js >/dev/null 2>&1; then
  echo "[verify-dist-hash] FAIL: dist/assets 에 번들 JS 가 없습니다." >&2
  exit 1
fi

# 3) entry asset 파일명이 hash 패턴([name].[hash].js)을 따르는지 (최소 1개).
if ! ls "$DIST"/assets/index.*.js >/dev/null 2>&1; then
  echo "[verify-dist-hash] FAIL: dist/assets/index.<hash>.js 형태의 entry 가 없습니다." >&2
  exit 1
fi

echo "[verify-dist-hash] ✅ index.html 이 content-hash asset 만 참조 + dist/assets 번들 확인"
