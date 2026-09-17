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
#      같은 30건이면 TTFT·전체 시간 p50/p95·출력 토큰을 baselines/latency-baseline.json 과 비교해 +20%(OMK_EVAL_LATENCY_REGRESSION_PCT) 초과 시 실패
#      같은 조건으로 로컬 llm.local 단가 기준 추정 비용을 baselines/cost-baseline.json 과 비교해 +20%(OMK_EVAL_COST_REGRESSION_PCT) 초과 시 실패(S6, 기준선 없으면 통과)
#   4) eval:response --real --tag multimodal — 이미지 첨부 10건(차트·표·OCR·색·개수·8장 묶음)
#      장문 컨텍스트 10건(8k·32k·96k needle)은 NIGHTLY_EVAL_LONG_CONTEXT=1 일 때만
#   5) eval:tools --real       — 도구 선택 골든셋 40건, 모델 첫 턴 tool_calls 관찰(dry-run·첫 관찰 즉시 중단)
#   6) eval:redteam --real     — 레드팀 12건(프롬프트·비밀값 유출, 관리자 도구 사칭, 첨부 문서 간접 인젝션 — 도구 dry-run)
#   7) eval:matrix (선택)      — NIGHTLY_EVAL_MATRIX=1 일 때 모델 × variant 비교(기본 qwen3.8-27b × base,concise × 10건)
# 모든 단계 결과는 eval_runs(146)에 기록된다(NIGHTLY_EVAL_RECORD_DB=false 로 끔).
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
# 실행 이력을 eval_runs(146)에 남긴다 — 관리자 /admin/evaluations·SLO eval_pass 가 읽는다.
# mock 러너는 .env 를 읽지 않으므로 DATABASE_URL 을 여기서 넘긴다(끄기: NIGHTLY_EVAL_RECORD_DB=false).
export OMK_EVAL_RECORD_DB="${NIGHTLY_EVAL_RECORD_DB:-true}"
if [ -z "${DATABASE_URL:-}" ]; then
    DATABASE_URL="$(grep -E "^DATABASE_URL=" "$REPO/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"')"
    export DATABASE_URL
fi
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
run_step "eval:multimodal-real" npm --workspace apps/api run eval:response -- --real --tag multimodal --limit 10
# 장문 컨텍스트(8k~96k 토큰) — 긴 prefill 이 운영 vLLM 에 부담이라 기본 꺼짐. 2026-09-17 ~148k 토큰 요청이
# 앱 fast-fail abort 직후 EngineCore 를 죽인 적이 있다(원인 미확정) — 켜기 전에 DGX 여유를 확인할 것.
if [ "${NIGHTLY_EVAL_LONG_CONTEXT:-0}" = "1" ]; then
    run_step "eval:long-context-real" npm --workspace apps/api run eval:response -- --real --tag long-context --limit 10
fi
run_step "eval:tools-real"     npm --workspace apps/api run eval:tools -- --real --limit 40
run_step "eval:redteam-real"   npm --workspace apps/api run eval:redteam -- --real --limit 12
# 모델 × 프롬프트 매트릭스(선택) — 호출 수 = 모델 × variant × 케이스라 기본 꺼짐
if [ "${NIGHTLY_EVAL_MATRIX:-0}" = "1" ]; then
    run_step "eval:matrix" npm --workspace apps/api run eval:matrix -- --real \
        --models "${NIGHTLY_EVAL_MATRIX_MODELS:-qwen3.8-27b}" --variants "${NIGHTLY_EVAL_MATRIX_VARIANTS:-base,concise}" --limit "${NIGHTLY_EVAL_MATRIX_LIMIT:-10}"
fi

echo >> "$OUT"
echo "실패 단계: ${FAILED_STEPS[*]:-없음}" >> "$OUT"
echo "[nightly-eval] 리포트: $OUT (실패 ${#FAILED_STEPS[@]}건)"

if [ "${#FAILED_STEPS[@]}" -gt 0 ]; then
    WEBHOOK="$(grep -E "^OPERATOR_WEBHOOK_URL=" "$REPO/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"')"
    # 지연 회귀 항목(eval:response-real 의 [latency-regression] 줄)을 통지에 함께 싣는다 — JSON 문자열용으로 따옴표·역슬래시 제거
    REGRESSIONS="$(grep -E "^\[latency-regression\]" "$OUT" 2>/dev/null | sed 's/^\[latency-regression\] //' | tr -d '"\\' | paste -sd ';' -)"
    if [ -n "${WEBHOOK:-}" ]; then
        curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
            -d "{\"text\":\"[nightly-eval] 평가 실패: ${FAILED_STEPS[*]}${REGRESSIONS:+ — 지연 회귀: $REGRESSIONS} — $OUT\"}" \
            "$WEBHOOK" >/dev/null 2>&1 || echo "[nightly-eval] webhook 통지 실패 (리포트는 저장됨)"
    fi
    exit 1
fi
