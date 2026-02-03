#!/bin/bash
# OpenMake 전체 서비스 시작 스크립트
# #15 개선: set -euo pipefail 적용

set -euo pipefail

echo "🚀 OpenMake 서비스 시작 중..."

# 빌드 확인
if [ ! -d "backend/api/dist" ]; then
    echo "📦 Backend API 빌드 중..."
    (cd backend/api && npm run build)
fi

if [ ! -d "backend/core/dist" ]; then
    echo "📦 Backend Core 빌드 중..."
    (cd backend/core && npm run build)
fi

# 데이터베이스 디렉토리 생성
mkdir -p data

# 서비스 시작 (Node.js 직접 실행)
echo "🎯 서비스 시작 중..."
node backend/api/dist/server.js &

# PID 저장
echo $! > .server.pid

echo "✅ OpenMake 서비스 시작 완료!"
echo "📋 서버 PID: $(cat .server.pid)"
echo "🛑 중지: ./infrastructure/scripts/stop-all.sh"
