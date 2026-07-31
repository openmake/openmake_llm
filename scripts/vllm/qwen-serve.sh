#!/usr/bin/env bash
# ============================================================
# qwen3.6-35b-a3b — 기본 채팅 (262K context) @ :8002
# ============================================================
# DGX 실측 serve 명령 기준 (2026-07-31 동기화 — LiteLLM Mac 이전 후 vLLM 전용 plane).
# 실행 주체: DGX 의 PM2 (`pm2-<user>.service` 아래 vllm-chat) — systemd 개별 유닛 아님.
# venv: /home/smith/vllm/rebuild/vllm_env.023 (qwen3.6 지원 rebuild)
#
# 보안:
# - API key 는 CLI 인자 금지(ps 노출) — 0600 env 파일의 VLLM_API_KEY 를 vLLM 이 직접 인식
# - 운영은 VLLM_BIND_HOST 에 DGX Tailscale IPv4 주입 (공인망·LAN 비노출).
#   tailscaled 기동 전 부팅 경쟁은 아래 대기 루프로 방어.
set -euo pipefail

MODEL_DIR="${QWEN_MODEL_DIR:-/home/smith/models/qwen3.6-35b-a3b-fp8}"

# vLLM API key — env 파일(0600) 주입 (VLLM_API_KEY)
set -a; [ -f /home/smith/vllm/vllm.env ] && . /home/smith/vllm/vllm.env; set +a

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
  --served-model-name qwen3.6-35b-a3b \
  --max-model-len 262144 \
  --gpu-memory-utilization 0.47 \
  --max-num-batched-tokens 8192 \
  --reasoning-parser qwen3 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --limit-mm-per-prompt '{"image": 4}' \
  --speculative-config '{"method": "mtp", "num_speculative_tokens": 1}' \
  --kv-cache-dtype fp8 \
  --override-generation-config '{"repetition_penalty": 1.05}'
