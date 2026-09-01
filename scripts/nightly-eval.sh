#!/usr/bin/env bash
# ============================================================
# Nightly 모델 평가 — PM2 cron_restart 로 매일 1회 실행 (2026-09-01)
# ============================================================
# 등록(1회만, 운영자 수동):
#   pm2 start scripts/nightly-eval.sh --name nightly-eval \
#       --cron "40 3 * * *" --no-autorestart && pm2 save
# 해제:
#   pm2 delete nightly-eval && pm2 save
#
# 목적: CI 는 vLLM/LiteLLM 에 닿지 못해 mock 기반이다. 실모델 회귀(언어 정책,
# 거절 환각, 형식 준수)는 게이트웨이가 있는 이 Mac 에서 nightly 로 감시한다.
#   1) eval:routing            — 결정적 키워드 라우터 (골든셋 v0.8.0 baseline 77.5%)
#   2) eval:response (mock)    — 평가기/룰셋 자가 점검 (baseline 100%)
#   3) eval:response --real    — LiteLLM 경유 실모델 (기본 limit 30 = response 전체:
#      applyLimit 이 앞에서부터 자르므로 limit 을 줄이면 뒤쪽 신규 케이스가 빠진다)
# 실패 시 OPERATOR_WEBHOOK_URL(.env) 로 통지 — pm2 cron 은 앱 env 를 상속하지
# 않으므로 .env 에서 직접 읽는다 (daily-routing-report.sh 와 같은 이유).
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO/logs/eval-reports"             # logs/ 는 .gitignore 대상
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/$(date +%Y-%m-%d).txt"

# pm2 cron 환경엔 npm 이 PATH 에 없을 수 있다 (mise/homebrew 셋업 대응)
if ! command -v npm >/dev/null 2>&1; then
    for p in "$HOME/.local/share/mise/shims" /opt/homebrew/bin /usr/local/bin; do
        [ -x "$p/npm" ] && PATH="$p:$PATH" && break
    done
fi
if ! command -v npm >/dev/null 2>&1; then
    echo "[nightly-eval] npm 을 찾을 수 없습니다 — PATH 를 확인하세요" | tee "$OUT"
    exit 1
fi

REAL_LIMIT="${NIGHTLY_EVAL_REAL_LIMIT:-30}"
FAILED_STEPS=()

run_step() {
    local name="$1"; shift
    echo "── $name ──" >> "$OUT"
    if "$@" >>"$OUT" 2>&1; then
        echo "[nightly-eval] $name: OK"
    else
        echo "[nightly-eval] $name: FAIL (exit $?)"
        FAILED_STEPS+=("$name")
    fi
}

{
    echo "# Nightly 모델 평가"
    date "+측정: %Y-%m-%d %H:%M"
    echo
} > "$OUT"

cd "$REPO" || exit 1
run_step "eval:routing"        npm --workspace apps/api run eval:routing
run_step "eval:response-mock"  npm --workspace apps/api run eval:response
run_step "eval:response-real"  npm --workspace apps/api run eval:response -- --real --limit "$REAL_LIMIT"

echo >> "$OUT"
echo "실패 단계: ${FAILED_STEPS[*]:-없음}" >> "$OUT"
echo "[nightly-eval] 리포트: $OUT (실패 ${#FAILED_STEPS[@]}건)"

if [ "${#FAILED_STEPS[@]}" -gt 0 ]; then
    WEBHOOK="$(grep -E "^OPERATOR_WEBHOOK_URL=" "$REPO/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"')"
    if [ -n "${WEBHOOK:-}" ]; then
        curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
            -d "{\"text\":\"[nightly-eval] 평가 실패: ${FAILED_STEPS[*]} — $OUT\"}" \
            "$WEBHOOK" >/dev/null 2>&1 || echo "[nightly-eval] webhook 통지 실패 (리포트는 저장됨)"
    fi
    exit 1
fi
