#!/bin/bash
# OpenMake 전체 서비스 중지 스크립트
# #15 개선: set -euo pipefail 적용, 에러 처리 강화

set -eo pipefail

echo "🛑 OpenMake 서비스 중지 중..."

# PID 파일로 프로세스 종료
if [ -f ".server.pid" ]; then
    PID=$(cat .server.pid)
    if ps -p "$PID" > /dev/null 2>&1; then
        kill "$PID"
        # graceful shutdown 대기 (최대 10초)
        for i in $(seq 1 10); do
            if ! ps -p "$PID" > /dev/null 2>&1; then
                echo "✅ 서버 프로세스 (PID: $PID) 종료됨"
                break
            fi
            sleep 1
        done
        # 10초 후에도 살아있으면 강제 종료
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "⚠️ 서버가 응답하지 않아 강제 종료합니다..."
            kill -9 "$PID" 2>/dev/null || true
            echo "✅ 서버 프로세스 (PID: $PID) 강제 종료됨"
        fi
    else
        echo "⚠️ 프로세스가 이미 종료됨"
    fi
    rm -f .server.pid
else
    # PID 파일 없으면 프로세스 이름으로 찾기
    pkill -f "node backend/api/dist/server.js" || echo "⚠️ 실행 중인 서버 없음"
fi

echo "✅ 모든 서비스가 중지되었습니다."
