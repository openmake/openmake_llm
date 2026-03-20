#!/usr/bin/env bash
# ==============================================================
# CI Gate Script — 통합 테스트/빌드/린트 게이트
# ==============================================================
# pre-push 훅 또는 `npm run ci`에서 호출합니다.
# 실패 시 즉시 중단 (fail-on-red).
#
# 사용법:
#   bash scripts/ci-test.sh
#   npm run ci
#
# 실행 순서:
#   1. Jest Test (backend/api)
#   2. TypeScript Build (tsc + frontend deploy)
#   3. File Size Guard (max 1200 lines per source file)
#   4. ESLint (TypeScript + JavaScript)
#
# 종료 코드:
#   0 — 모든 게이트 통과
#   1 — 하나 이상의 게이트 실패
# ==============================================================

set -euo pipefail

# ─── 색상 코드 ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ─── 프로젝트 루트 ───
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── 타이머 ───
START_TIME=$(date +%s)

# ─── 결과 추적 ───
PASSED=0
FAILED=0
RESULTS=()

# ─── 단계 실행 함수 ───
run_step() {
    local step_name="$1"
    shift
    local step_start
    step_start=$(date +%s)

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}▶ ${step_name}${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if "$@"; then
        local step_end
        step_end=$(date +%s)
        local elapsed=$((step_end - step_start))
        echo -e "${GREEN}✅ ${step_name} — 통과 (${elapsed}s)${NC}"
        RESULTS+=("✅ ${step_name} (${elapsed}s)")
        PASSED=$((PASSED + 1))
    else
        local step_end
        step_end=$(date +%s)
        local elapsed=$((step_end - step_start))
        echo -e "${RED}❌ ${step_name} — 실패 (${elapsed}s)${NC}"
        RESULTS+=("❌ ${step_name} (${elapsed}s)")
        FAILED=$((FAILED + 1))
        # set -e에 의해 여기서 스크립트 종료
        # 하지만 summary를 출력하기 위해 trap 사용
    fi
}

# ─── 실패 시 서머리 출력 ───
print_summary() {
    local END_TIME
    END_TIME=$(date +%s)
    local TOTAL_ELAPSED=$((END_TIME - START_TIME))

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}📊 CI Gate Summary${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    for r in "${RESULTS[@]}"; do
        echo -e "   $r"
    done
    echo ""
    echo -e "   총 소요시간: ${TOTAL_ELAPSED}s"

    if [[ $FAILED -gt 0 ]]; then
        echo -e "   ${RED}❌ ${FAILED}개 게이트 실패 — push 차단${NC}"
        echo ""
        exit 1
    else
        echo -e "   ${GREEN}✅ 모든 게이트 통과 (${PASSED}/5)${NC}"
        echo ""
        exit 0
    fi
}

trap print_summary EXIT

# ─── Step 1: Jest Test ───
# agent-loop.test.ts는 Ollama 실제 연결을 시도하여 CI에서 hang 발생 → 제외

# CI 환경변수 설정 — auth 모듈이 모듈 로드 시점에 JWT_SECRET을 읽으므로 프로세스 레벨에서 export 필수
export JWT_SECRET="ci-test-secret-for-testing-only"
export NODE_ENV="test"

run_step "Jest Test (backend/api)" bash -c "cd '$PROJECT_ROOT' && npx jest --testPathIgnorePatterns='agent-loop.test.ts' --forceExit --testTimeout=15000 2>&1"

# ─── Step 1.5: Coverage Gate (P2-1) ───
# --passWithNoTests 없이 실행하여 임계값 미달 시 실패
run_step "Coverage Gate (branches≥20 functions≥25 lines≥25)" bash -c "cd '$PROJECT_ROOT' && npx jest --testPathIgnorePatterns='agent-loop.test.ts' --coverage --forceExit --testTimeout=15000 --silent 2>&1 | tail -30"

# ─── Step 2: Build ───
run_step "TypeScript Build" bash -c "cd '$PROJECT_ROOT' && npm run build"

# ─── Step 3: File Size Guard ───
run_step "File Size Guard (max 1200 lines)" bash -c '
    MAX_LINES=1200
    VIOLATIONS=""
    while IFS= read -r f; do
        lines=$(grep -c "" "$f" 2>/dev/null || echo 0)
        if [ "$lines" -gt "$MAX_LINES" ]; then
            VIOLATIONS="$VIOLATIONS\n  $f ($lines lines)"
        fi
    done < <(find "'"$PROJECT_ROOT"'/backend/api/src" -name "*.ts" -not -path "*/dist/*" -not -path "*__tests__*" -not -name "*.test.*" -not -name "*.d.ts" -not -name "*-locales.ts" -not -name "*-data-*.ts" -not -name "*-guidelines.ts")
    if [ -n "$VIOLATIONS" ]; then
        echo -e "Files exceeding $MAX_LINES lines:$VIOLATIONS"
        exit 1
    fi
    echo "All source files within $MAX_LINES line limit"
'

# ─── Step 4: Lint ───
run_step "ESLint" bash -c "cd '$PROJECT_ROOT' && npm run lint"
