#!/usr/bin/env bash
# ============================================================
# llm-droprate-probe.sh — vLLM/LiteLLM tool calling drop rate 측정
# ============================================================
#
# 목적
#   동일 prompt 를 N 회 반복 호출하여 EXAONE 4.x (또는 다른 모델) 의
#   tool calling 실패 모드 분포를 정량 측정. C (vLLM plugin) 도입의
#   *의사결정 근거* (drop rate ≥ 10% 면 즉시 진행, 1% 미만이면 보류 등).
#
# 사용
#   # 기본 (N=30, exaone4.5-33b-awq, 외부 서버 직접)
#   ./scripts/llm-droprate-probe.sh
#
#   # 환경 변수 오버라이드
#   ENDPOINT=http://localhost:8002 N=50 MODEL=exaone4.5-33b-awq \
#     ./scripts/llm-droprate-probe.sh
#
#   # 다른 prompt
#   PROMPT="부산 날씨 알려줘" ./scripts/llm-droprate-probe.sh
#
# 산출물
#   /tmp/llm-droprate-<timestamp>/  (재현 가능한 raw 데이터)
#     ├─ probe-001.json  ...  probe-NNN.json   각 호출 raw 응답
#     ├─ summary.jsonl                          호출별 분류 1줄씩
#     └─ summary.txt                            의사결정 요약
#
# 분류 (mutually exclusive)
#   ✅ tool_calls_populated   — tool_calls 배열 정상 채워짐 (성공)
#   ❌ native_format_leak      — content 에 raw <tool_call> XML 누출
#   ⚠️ intent_only             — 호출 의도만 진술, marker 없이 자연어 마감
#   💥 other                   — HTTP 오류, malformed JSON 등
#
# 의사결정 가이드 (drop_rate = (leak + intent + other) / N)
#   drop_rate ≥ 10%  → Phase 1 (vLLM plugin) 즉시 진행 권고
#   1% ≤ rate < 10%  → 측정 N=100 으로 늘리고 부분 자동화 검토
#   drop_rate < 1%   → 현 상태 유지 + 모니터링 (계속 측정)
#
# 안전성
#   - 외부 서버에 부하 발생: 기본 N=30 (모델당 ~3-10초 → 총 1-5분)
#   - jq, curl 필수
#   - 절대 destructive 동작 없음 (read-only 호출)
# ============================================================

set -euo pipefail

# ─── 설정 (env 오버라이드 가능) ───────────────────────────────
ENDPOINT="${ENDPOINT:-http://localhost:8002}"
API_KEY="${API_KEY:-sk-vllm}"
MODEL="${MODEL:-exaone4.5-33b-awq}"
N="${N:-30}"
PROMPT="${PROMPT:-서울 날씨를 알려줘}"
TIMEOUT_SEC="${TIMEOUT_SEC:-60}"

# ─── 출력 디렉토리 ─────────────────────────────────────────────
TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${OUT_DIR:-/tmp/llm-droprate-${TS}}"
mkdir -p "${OUT_DIR}"

SUMMARY_JSONL="${OUT_DIR}/summary.jsonl"
SUMMARY_TXT="${OUT_DIR}/summary.txt"
: > "${SUMMARY_JSONL}"

# ─── 사전 검증 ─────────────────────────────────────────────────
for tool in curl jq; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "ERROR: required tool '$tool' not found in PATH" >&2
        exit 1
    fi
done

# ─── 요청 페이로드 ─────────────────────────────────────────────
REQ_BODY=$(jq -n \
    --arg model "$MODEL" \
    --arg prompt "$PROMPT" \
    '{
        model: $model,
        messages: [{role: "user", content: $prompt}],
        tools: [{
            type: "function",
            function: {
                name: "get_weather",
                description: "도시 날씨 조회",
                parameters: {
                    type: "object",
                    properties: {city: {type: "string"}},
                    required: ["city"]
                }
            }
        }],
        tool_choice: "auto"
    }')

# ─── 메인 루프 ─────────────────────────────────────────────────
echo "Probing ${ENDPOINT}/v1/chat/completions"
echo "Model: ${MODEL}  ·  N=${N}  ·  prompt=\"${PROMPT}\""
echo "Output: ${OUT_DIR}"
echo "─────────────────────────────────────────"

count_ok=0
count_leak=0
count_intent=0
count_other=0

for i in $(seq 1 "$N"); do
    pad=$(printf "%03d" "$i")
    raw_file="${OUT_DIR}/probe-${pad}.json"

    # HTTP 호출 — body 가 200 이 아니면 other 분류
    http_code=$(curl -sS -o "${raw_file}" -w "%{http_code}" \
        --max-time "${TIMEOUT_SEC}" \
        -X POST "${ENDPOINT}/v1/chat/completions" \
        -H "Authorization: Bearer ${API_KEY}" \
        -H "Content-Type: application/json" \
        -d "${REQ_BODY}" || echo "000")

    if [[ "$http_code" != "200" ]]; then
        printf "%s  💥 HTTP %s\n" "$pad" "$http_code"
        jq -n --arg i "$pad" --arg code "$http_code" \
            '{i: $i, class: "other", http_code: $code}' >> "${SUMMARY_JSONL}"
        count_other=$((count_other + 1))
        continue
    fi

    # JSON 분류
    classify=$(jq -c '
        {
            i: "'"$pad"'",
            has_tool_calls: (.choices[0].message.tool_calls != null and (.choices[0].message.tool_calls | length) > 0),
            content: (.choices[0].message.content // ""),
            finish_reason: .choices[0].finish_reason
        } |
        . + {
            has_native_leak: (.content | test("<tool_call>"; "i")),
            has_intent_phrase: (.content | test("(get_weather|날씨를 (확인|알려))"; "i"))
        } |
        . + {
            class: (
                if .has_tool_calls then "tool_calls_populated"
                elif .has_native_leak then "native_format_leak"
                elif .has_intent_phrase then "intent_only"
                else "intent_only"  # 보수적 — marker 없으면 intent only 로 묶음
                end
            )
        }
    ' "${raw_file}" 2>/dev/null || jq -n --arg i "$pad" '{i: $i, class: "other", error: "jq_parse_fail"}')

    cls=$(echo "$classify" | jq -r '.class')
    echo "$classify" >> "${SUMMARY_JSONL}"

    case "$cls" in
        tool_calls_populated) count_ok=$((count_ok + 1));        printf "%s  ✅ tool_calls\n" "$pad" ;;
        native_format_leak)   count_leak=$((count_leak + 1));    printf "%s  ❌ native_leak\n" "$pad" ;;
        intent_only)          count_intent=$((count_intent + 1)); printf "%s  ⚠️  intent_only\n" "$pad" ;;
        *)                    count_other=$((count_other + 1));   printf "%s  💥 other\n" "$pad" ;;
    esac
done

# ─── 요약 출력 ─────────────────────────────────────────────────
drop_rate_pct=$(awk -v fail=$((count_leak + count_intent + count_other)) -v total="$N" \
    'BEGIN {printf "%.1f", fail * 100.0 / total}')
ok_rate_pct=$(awk -v ok="$count_ok" -v total="$N" \
    'BEGIN {printf "%.1f", ok * 100.0 / total}')

# 95% Wilson CI for drop_rate
wilson_ci=$(awk -v p_hat=$((count_leak + count_intent + count_other)) -v n="$N" \
    'BEGIN {
        if (n == 0) {print "n/a"; exit}
        p = p_hat / n
        z = 1.96
        denom = 1 + z*z/n
        center = (p + z*z/(2*n)) / denom
        margin = z * sqrt((p*(1-p) + z*z/(4*n))/n) / denom
        lo = (center - margin) * 100
        hi = (center + margin) * 100
        if (lo < 0) lo = 0
        if (hi > 100) hi = 100
        printf "[%.1f%%, %.1f%%]", lo, hi
    }')

{
    echo "============================================================"
    echo "  Drop Rate Probe — Summary"
    echo "============================================================"
    echo "  endpoint     : ${ENDPOINT}"
    echo "  model        : ${MODEL}"
    echo "  prompt       : ${PROMPT}"
    echo "  N            : ${N}"
    echo "  timestamp    : ${TS}"
    echo "─────────────────────────────────────────"
    printf "  ✅ tool_calls populated  : %3d / %d  (%5s%%)\n" "$count_ok" "$N" "$ok_rate_pct"
    printf "  ❌ native_format_leak     : %3d / %d\n" "$count_leak" "$N"
    printf "  ⚠️  intent_only            : %3d / %d\n" "$count_intent" "$N"
    printf "  💥 other (HTTP/parse)     : %3d / %d\n" "$count_other" "$N"
    echo "─────────────────────────────────────────"
    printf "  drop_rate    : %s%%  (95%% CI %s)\n" "$drop_rate_pct" "$wilson_ci"
    echo "─────────────────────────────────────────"
    case 1 in
        $(( $(echo "$drop_rate_pct >= 10" | bc -l 2>/dev/null || echo 0) )))
            echo "  📍 의사결정 권고: Phase 1 (vLLM plugin) 즉시 진행 — drop_rate ≥ 10%"
            ;;
        $(( $(echo "$drop_rate_pct >= 1" | bc -l 2>/dev/null || echo 0) )))
            echo "  📍 의사결정 권고: N=100 으로 측정 확대 + Phase 1 계획 수립"
            ;;
        *)
            echo "  📍 의사결정 권고: 현 상태 유지 + 주기적 모니터링"
            ;;
    esac
    echo "============================================================"
    echo "  raw : ${OUT_DIR}/probe-*.json"
    echo "  jsonl: ${SUMMARY_JSONL}"
} | tee "${SUMMARY_TXT}"
