#!/bin/bash
# Health Check 스크립트
# #15 개선: set -euo pipefail 적용, 종료 코드 반환

set -eo pipefail

API_URL="${API_URL:-http://localhost:52416}"
EXIT_CODE=0

echo "🏥 OpenMake Health Check"
echo "========================"

# API 서버 확인
echo -n "API Server: "
if curl -sf "${API_URL}/health" > /dev/null 2>&1; then
    echo "✅ OK"
    curl -sf "${API_URL}/health" | jq '.' 2>/dev/null || true
else
    echo "❌ Failed"
    EXIT_CODE=1
fi

echo ""

# Ready 상태 확인
echo -n "Ready Status: "
if curl -sf "${API_URL}/ready" > /dev/null 2>&1; then
    echo "✅ OK"
    curl -sf "${API_URL}/ready" | jq '.' 2>/dev/null || true
else
    echo "❌ Failed"
    EXIT_CODE=1
fi

echo ""
echo "========================"

exit $EXIT_CODE
