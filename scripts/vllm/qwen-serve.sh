#!/usr/bin/env bash
# ============================================================
# qwen3.8-27b — 기본 채팅 (262K context) @ :8002
# ============================================================
# ⚠️ 2026-10-07 동기화 (DGX ~/vllm/env/chat.env 실측 기준 — 이 파일은 참조본, SoT 는 chat.env):
#   - 2026-09-14 가중치 qwen3.8-27b-fp8 → nvidia/Qwen3.8-27B-NVFP4(modelopt MIXED_PRECISION: MLP·lm_head NVFP4
#     + attention FP8, MTP 는 bf16). 29G→22G. 서빙 이름은 API 계약이라 qwen3.8-27b 그대로.
#   - 2026-09-02 구 이름 별칭(qwen3.6-35b-a3b) 제거 — 별칭을 두면 /v1/models 에 옛 이름이 함께 떠서
#     클라이언트가 구 모델이 뜬 것처럼 표시된다. 이제 노출 이름은 qwen3.8-27b 하나.
#   - 2026-10-30 서빙 이름을 env(QWEN_SERVED_MODEL_NAME·QWEN_SERVED_MODEL_ALIASES)로 — 모델 전환 때 옛 이름은
#     vLLM alias 로 남기되, 앱 목록은 게이트웨이(omk OMK_DGX_MODEL)가 정식 이름 하나로 접는다(scripts/env/README.md).
#   - 2026-09-23 vLLM 0.27.1 → 0.30.0 (venv vllm_env.0300, 롤백 vllm_env.0271). VLLM_USE_DEEP_GEMM=0.
#   - 2026-10-03 JEV-27B-VL 의사결정 어댑터를 같은 엔진·같은 포트에 LoRA 로 노출(model="jev-decision").
#     앱 쪽: config/decision.ts, services/decision/jev-decision.ts, services/orchestrator/media-gate.ts.
#     --max-num-seqs 8: 멀티모달 LoRA 경로가 배치 8 초과 시 System 1 확률이 틀어짐(모델 카드 명시).
#     결정 요청은 top_k 0 · top_p 1.0 · repetition_penalty 1.0 필수(기본값이 logprob 을 왜곡).
#   - 2026-10-04 --enable-prompt-tokens-details: usage 에 prompt_tokens_details.cached_tokens 를 낸다
#     (에이전트 작업의 캐시 적중 집계용).
#   - 2026-10-05 --scheduling-policy priority: 요청 priority(작을수록 먼저) 순 처리 — 화면 채팅이 에이전트 작업·
#     배경 요청보다 앞선다(앱 쪽 config/llm-priority.ts, LLM_PRIORITY_ENABLED). priority 없는 요청은 0(가장 앞).
#   아래 플래그 중 하나라도 빠지면 앱의 캐시 집계·우선순위·jev 게이트가 조용히 꺼진다.
#
# ⚠️ 2026-09-02 동기화: DGX :8002 실체가 qwen3.8-27b-fp8(dense, MTP) 로 교체됐고(DGX 측 2026-08-31)
#   `--served-model-name qwen3.8-27b qwen3.6-35b-a3b` 로 구 이름을 호환 alias 로 함께 서빙한다.
#   실행 주체도 바뀜 — PM2 가 아니라 DGX `$VLLM_HOME`(git: openmake/openmake_vllm) 의
#   docker compose (`vllm-chat` 컨테이너, `bin/vllm-launch.sh chat` + `env/chat.env`, 2026-08-20 컷오버).
#   이 파일은 레포 참조본이며 실제 SoT 는 openmake_vllm 의 env/chat.env 다.
# DGX 실측 serve 명령 기준 (2026-08-19 동기화 — --limit-mm-per-prompt image 4→8:
# 채팅 PDF 하이브리드(pdf-vision 페이지 주입, PDF_VISION_TOTAL_IMAGE_CAP=8 페어) 지원.
# 2026-08-02 prefix caching 추가).
#
# --enable-prefix-caching (2026-08-02 추가):
#   앱은 이 기능을 전제로 프롬프트를 배치한다 — external-system-prompt.ts 가 정적 헌법을
#   맨 앞(CACHE PREFIX)에 두는 이유가 그것인데, 서버에서 꺼져 있어 설계 의도가 무효였다.
#   도구 루프 N턴이면 시스템 프롬프트를 N번 재계산하므로 지연에 직결된다.
#   ⚠️ 이 모델은 Mamba 하이브리드(Qwen3_5MoeForConditionalGeneration)라 vLLM 이
#   Mamba cache 'align' 모드로 전환하며 "experimental" 경고를 낸다. 활성화 후에도
#   `Prefix cache hit rate` 지표는 0.0% 로 표시된다(SSM 레이어는 KV 캐시가 없음).
#   앱 실측(표본 4건)은 3건 개선·1건 악화로 유의성 미확보 — [ChatTiming] 로그 축적 후 재판단.
#   문제 시 이 플래그만 제거하면 종전 동작으로 복귀한다.
# 실행 주체: (구) DGX PM2 vllm-chat → (현) docker compose `vllm-chat` — 위 2026-09-02 주석 참고.
# venv: $VLLM_HOME 아래 vllm_env.0300 (vLLM 0.30.0, 2026-09-23 — 이전 0.27.1 은 vllm_env.0271)
#
# 보안:
# - API key 는 CLI 인자 금지(ps 노출) — 0600 env 파일의 VLLM_API_KEY 를 vLLM 이 직접 인식
# - 운영은 VLLM_BIND_HOST 에 DGX Tailscale IPv4 주입 (공인망·LAN 비노출).
#   tailscaled 기동 전 부팅 경쟁은 아래 대기 루프로 방어.
set -euo pipefail

# 경로는 환경마다 다르다 — VLLM_HOME(기본 ~/vllm)·MODELS_DIR(기본 ~/models). 롤백: QWEN_MODEL_DIR=$MODELS_DIR/qwen3.8-27b-fp8
VLLM_HOME="${VLLM_HOME:-$HOME/vllm}"; MODELS_DIR="${MODELS_DIR:-$HOME/models}"
MODEL_DIR="${QWEN_MODEL_DIR:-$MODELS_DIR/qwen3.8-27b-nvfp4}"
export VLLM_USE_DEEP_GEMM=0

# vLLM API key — env 파일(0600) 주입 (VLLM_API_KEY)
set -a; [ -f "$VLLM_HOME/vllm.env" ] && . "$VLLM_HOME/vllm.env"; set +a

# 서빙 이름 (2026-10-30) — 모델을 바꿀 때 정식 이름(QWEN_SERVED_MODEL_NAME)을 맨 앞에, 옛 대화가 부르는 옛 이름을
# 호환 alias(QWEN_SERVED_MODEL_ALIASES, 공백 구분)로 뒤에 둔다. vLLM 은 둘 다 받는다. 주지 않으면 종전대로 qwen3.8-27b 하나.
# 값은 프로세스 env 또는 위 env 파일에서 온다(env 파일을 읽은 뒤 조립 — 둘 다 있으면 env 파일 값).
# 이름은 ID 일 뿐이다 — 어떤 가중치인지는 위 MODEL_DIR 과 운영자 기록이 정한다. 게이트웨이·앱 쪽은 omk 의 OMK_DGX_MODEL.
SERVED_NAMES=("${QWEN_SERVED_MODEL_NAME:-qwen3.8-27b}")
read -r -a _aliases <<< "${QWEN_SERVED_MODEL_ALIASES:-}"
SERVED_NAMES+=(${_aliases[@]+"${_aliases[@]}"})
for _n in "${SERVED_NAMES[@]}"; do
  [[ "$_n" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || { echo "[qwen-serve] 서빙 이름 형식 오류: $_n" >&2; exit 2; }
done
[[ "$(printf '%s\n' "${SERVED_NAMES[@]}" | sort | uniq -d)" == "" ]] || { echo "[qwen-serve] 서빙 이름 중복: ${SERVED_NAMES[*]}" >&2; exit 2; }

VLLM_BIND_HOST="${VLLM_BIND_HOST:-127.0.0.1}"
if [ "$VLLM_BIND_HOST" != "127.0.0.1" ] && [ "$VLLM_BIND_HOST" != "0.0.0.0" ]; then
  for i in $(seq 1 60); do
    ip -4 addr show 2>/dev/null | grep -q "inet ${VLLM_BIND_HOST}/" && break
    echo "[bind-wait] waiting for ${VLLM_BIND_HOST} ($i/60)"; sleep 2
  done
fi

exec vllm serve "$MODEL_DIR" \
  --port 8002 \
  --host "$VLLM_BIND_HOST" \
  --tensor-parallel-size 1 \
  --dtype auto \
  --served-model-name "${SERVED_NAMES[@]}" \
  --max-model-len 262144 \
  --gpu-memory-utilization 0.47 \
  --max-num-batched-tokens 8192 \
  --reasoning-parser qwen3 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --limit-mm-per-prompt '{"image": 8}' \
  --speculative-config '{"method": "mtp", "num_speculative_tokens": 1}' \
  --kv-cache-dtype fp8 \
  --enable-prefix-caching \
  --enable-prompt-tokens-details \
  --scheduling-policy priority \
  --override-generation-config '{"repetition_penalty": 1.05}' \
  --enable-lora \
  --max-lora-rank 32 \
  --lora-modules jev-decision="$MODELS_DIR/jev-27b-vl/adapter_vllm" \
  --logprobs-mode processed_logprobs \
  --max-num-seqs 8 \
  --trust-request-chat-template
