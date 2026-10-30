#!/usr/bin/env bash
# ============================================================
# bge-m3 — multilingual embedding (pooling runner) @ :8003
# ============================================================
# DGX 실측 serve 명령 기준 (2026-07-31 동기화 — LiteLLM Mac 이전 후 vLLM 전용 plane).
# 실행 주체: DGX 의 PM2 (vllm-embed). venv: $VLLM_HOME/vllm_env (embedding 전용).
# 보안·바인딩 원칙은 qwen-serve.sh 헤더 참고 (VLLM_API_KEY env / VLLM_BIND_HOST Tailscale).
set -euo pipefail

VLLM_HOME="${VLLM_HOME:-$HOME/vllm}"; MODELS_DIR="${MODELS_DIR:-$HOME/models}"
MODEL_DIR="${BGE_MODEL_DIR:-$MODELS_DIR/bge-m3}"

set -a; [ -f "$VLLM_HOME/vllm.env" ] && . "$VLLM_HOME/vllm.env"; set +a

VLLM_BIND_HOST="${VLLM_BIND_HOST:-127.0.0.1}"
if [ "$VLLM_BIND_HOST" != "127.0.0.1" ] && [ "$VLLM_BIND_HOST" != "0.0.0.0" ]; then
  for i in $(seq 1 60); do
    ip -4 addr show 2>/dev/null | grep -q "inet ${VLLM_BIND_HOST}/" && break
    echo "[bind-wait] waiting for ${VLLM_BIND_HOST} ($i/60)"; sleep 2
  done
fi

exec vllm serve "$MODEL_DIR" \
  --runner pooling \
  --port 8003 \
  --host "$VLLM_BIND_HOST" \
  --served-model-name bge-m3 \
  --enforce-eager \
  --gpu-memory-utilization 0.05
