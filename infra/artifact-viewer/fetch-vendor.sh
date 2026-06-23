#!/usr/bin/env bash
# 뷰어 오리진에 self-host 할 라이브러리 + bootstrap.js 를 data/vendor 에 준비.
# 외부 CDN 0 (라이브러리를 뷰어 오리진에서 직접 서빙) 을 위해 1회 다운로드.
set -euo pipefail

DATA_DIR="${ARTIFACT_VIEWER_DATA_DIR:-/Volumes/MAC_APP/docker/openmake_llm/artifact-viewer/data}"
VENDOR="$DATA_DIR/vendor"
HERE="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$VENDOR"

fetch() { echo "  → $2"; curl -fsSL "$1" -o "$VENDOR/$2"; }

echo "라이브러리 다운로드 → $VENDOR"
fetch "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"            mermaid.min.js
fetch "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"      chart.umd.min.js
fetch "https://unpkg.com/react@18/umd/react.production.min.js"                 react.production.min.js
fetch "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"         react-dom.production.min.js
fetch "https://unpkg.com/@babel/standalone/babel.min.js"                       babel.min.js
fetch "https://cdn.jsdelivr.net/npm/marked/marked.min.js"                      marked.min.js

# 우리 렌더러 (repo SoT → vendor)
cp "$HERE/vendor/bootstrap.js" "$VENDOR/bootstrap.js"
echo "  → bootstrap.js (repo)"

echo "✓ vendor 준비 완료: $VENDOR"
