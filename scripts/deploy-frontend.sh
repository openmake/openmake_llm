#!/bin/bash
# ============================================
# 프론트엔드 배포 스크립트
# frontend/web/public → backend/api/dist/public 동기화
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SRC_DIR="$PROJECT_ROOT/frontend/web/public"
DEST_DIR="$PROJECT_ROOT/backend/api/dist/public"

# 색상 코드
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}[Deploy] 프론트엔드 배포 시작...${NC}"
echo "  소스: $SRC_DIR"
echo "  대상: $DEST_DIR"

# 소스 디렉토리 존재 확인
if [ ! -d "$SRC_DIR" ]; then
    echo "❌ 소스 디렉토리를 찾을 수 없습니다: $SRC_DIR"
    exit 1
fi

# 대상 디렉토리 생성 (없으면)
mkdir -p "$DEST_DIR"

# rsync로 동기화 (삭제 포함 - 소스에서 지운 파일도 대상에서 제거)
if command -v rsync &> /dev/null; then
    rsync -av --delete \
        --exclude='node_modules' \
        --exclude='.DS_Store' \
        "$SRC_DIR/" "$DEST_DIR/"
else
    # rsync 없으면 cp 사용
    echo "  (rsync 미설치 - cp 사용)"
    rm -rf "$DEST_DIR"/*
    cp -R "$SRC_DIR"/* "$DEST_DIR/"
fi

# 배포된 파일 수 카운트
FILE_COUNT=$(find "$DEST_DIR" -type f | wc -l | tr -d ' ')
echo ""
echo -e "${GREEN}✅ 프론트엔드 배포 완료! ($FILE_COUNT 파일)${NC}"

# Service Worker 캐시 버전 자동 업데이트
SW_FILE="$DEST_DIR/service-worker.js"
if [ -f "$SW_FILE" ]; then
    # 타임스탬프 기반 캐시 버전 업데이트
    TIMESTAMP=$(date +%s)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/const CACHE_NAME = '.*'/const CACHE_NAME = 'ollama-chat-v${TIMESTAMP}'/" "$SW_FILE"
    else
        sed -i "s/const CACHE_NAME = '.*'/const CACHE_NAME = 'ollama-chat-v${TIMESTAMP}'/" "$SW_FILE"
    fi
    echo -e "${GREEN}✅ Service Worker 캐시 버전 업데이트: ollama-chat-v${TIMESTAMP}${NC}"
fi
