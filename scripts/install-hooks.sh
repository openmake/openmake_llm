#!/usr/bin/env bash
# ==============================================================
# Git Hooks 설치 스크립트
# ==============================================================
# scripts/hooks/ 디렉토리의 훅 템플릿을 .git/hooks/에 설치합니다.
#
# 사용법:
#   bash scripts/install-hooks.sh
#   npm run hooks:install
#
# 멱등성: 이미 설치된 경우 덮어씁니다.
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

HOOKS_SRC="$ROOT_DIR/scripts/hooks"
HOOKS_DEST="$ROOT_DIR/.git/hooks"

# 색상 코드
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}[Hooks] Git hooks 설치 시작...${NC}"

# .git/hooks 디렉토리 존재 확인
if [[ ! -d "$HOOKS_DEST" ]]; then
    echo "❌ .git/hooks 디렉토리가 없습니다. Git 저장소 루트에서 실행하세요."
    exit 1
fi

# 설치할 훅 목록
INSTALLED=0

for hook_file in "$HOOKS_SRC"/*; do
    if [[ -f "$hook_file" ]]; then
        hook_name=$(basename "$hook_file")
        cp "$hook_file" "$HOOKS_DEST/$hook_name"
        chmod +x "$HOOKS_DEST/$hook_name"
        echo "   ✅ $hook_name 설치됨"
        INSTALLED=$((INSTALLED + 1))
    fi
done

if [[ $INSTALLED -eq 0 ]]; then
    echo "   ⚠️ 설치할 훅이 없습니다 (scripts/hooks/ 비어있음)"
else
    echo ""
    echo -e "${GREEN}✅ ${INSTALLED}개 Git hook 설치 완료!${NC}"
    echo "   우회 방법: git push --no-verify (긴급 시에만)"
fi
