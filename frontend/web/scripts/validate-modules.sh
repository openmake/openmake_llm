#!/bin/bash
# ============================================
# ES Module 정합성 검증 스크립트
# ============================================
# 모든 JS 파일이 올바른 방식으로 로드되는지 검증합니다.
# - type="module"로 로드되는 파일만 export/import 사용 가능
# - 일반 <script>로 로드되는 파일은 export/import 금지
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_DIR="$PROJECT_ROOT/public"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0

echo -e "${YELLOW}[Validate] ES Module 정합성 검증 시작...${NC}"

# ─── 1. 페이지 모듈 파일 검증: export default 필수 ───
echo "  [1/3] 페이지 모듈 export default 검증..."
for f in "$PUBLIC_DIR"/js/modules/pages/*.js; do
    if [ -f "$f" ]; then
        basename=$(basename "$f")
        if ! grep -q 'export default ' "$f"; then
            echo -e "  ${RED}✗ 페이지 모듈에 export default 누락: js/modules/pages/$basename${NC}"
            ERRORS=$((ERRORS + 1))
        fi
    fi
done

# ─── 2. HTML 파일 검증: 모든 <script>에 type="module" 필수 (vendor 제외) ───
echo "  [2/3] HTML script 태그 type=\"module\" 검증..."
for f in "$PUBLIC_DIR"/*.html; do
    if [ -f "$f" ]; then
        basename=$(basename "$f")
        # vendor/ 경로를 제외한 <script src> 중 type="module"이 없는 것 찾기
        violations=$(grep -n '<script ' "$f" 2>/dev/null | grep 'src=' | grep -v 'type="module"' | grep -v 'vendor/' | grep -v 'guide_content.js' || true)
        if [ -n "$violations" ]; then
            echo -e "  ${RED}✗ type=\"module\" 누락 ($basename):${NC}"
            echo "$violations" | while read -r line; do
                echo -e "    ${RED}$line${NC}"
            done
            ERRORS=$((ERRORS + 1))
        fi
        # inline <script> 중 type="module"이 없는 것 찾기 (src가 없는 script 태그)
        inline_violations=$(grep -n '<script>' "$f" 2>/dev/null || true)
        if [ -n "$inline_violations" ]; then
            echo -e "  ${RED}✗ inline script에 type=\"module\" 누락 ($basename):${NC}"
            echo "$inline_violations" | while read -r line; do
                echo -e "    ${RED}$line${NC}"
            done
            ERRORS=$((ERRORS + 1))
        fi
    fi
done

# ─── 3. IIFE 잔존 검증: 페이지 모듈에 (function 래퍼 잔존 감지 ───
echo "  [3/3] 페이지 모듈 IIFE 잔존 검증..."
for f in "$PUBLIC_DIR"/js/modules/pages/*.js; do
    if [ -f "$f" ]; then
        basename=$(basename "$f")
        if grep -q "^(function" "$f"; then
            echo -e "  ${RED}✗ IIFE 래퍼 잔존: js/modules/pages/$basename${NC}"
            ERRORS=$((ERRORS + 1))
        fi
    fi
done

# ─── 4. ES Module 문법 검증: export/import가 있는 JS 파일의 모듈 파싱 ───
echo "  [4/4] ES Module 문법 검증 (V8 파서)..."
MODULE_ERRORS=0
for f in "$PUBLIC_DIR"/js/modules/*.js "$PUBLIC_DIR"/js/modules/pages/*.js "$PUBLIC_DIR"/js/components/*.js "$PUBLIC_DIR"/js/spa-router.js "$PUBLIC_DIR"/js/nav-items.js; do
    if [ -f "$f" ]; then
        basename=$(basename "$f")
        # export 또는 import 키워드가 있는 파일만 모듈로 검증
        if grep -qE '^(import |export )' "$f" 2>/dev/null; then
            parse_result=$(node --experimental-vm-modules -e "
                const vm = require('vm');
                const fs = require('fs');
                try {
                    new vm.SourceTextModule(fs.readFileSync('$f', 'utf8'));
                    process.exit(0);
                } catch(e) {
                    console.error(e.message);
                    process.exit(1);
                }
            " 2>&1)
            if [ $? -ne 0 ]; then
                echo -e "  ${RED}✗ 모듈 파싱 실패: $basename — $parse_result${NC}"
                MODULE_ERRORS=$((MODULE_ERRORS + 1))
            fi
        fi
    fi
done
if [ $MODULE_ERRORS -gt 0 ]; then
    ERRORS=$((ERRORS + MODULE_ERRORS))
fi

# ─── 결과 ───
echo ""
if [ "$ERRORS" -gt 0 ]; then
    echo -e "${RED}✗ ES Module 검증 실패: $ERRORS개 오류${NC}"
    exit 1
else
    echo -e "${GREEN}✅ ES Module 정합성 검증 통과${NC}"
fi
