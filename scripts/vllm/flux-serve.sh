#!/usr/bin/env bash
# ============================================================
# flux2-klein — 이미지 생성 (vLLM-Omni, /v1/images/generations) @ :8005
# ============================================================
# DGX 실측 serve 명령 기준 (2026-07-31 — 수동 프로세스에서 PM2 `flux` 로 영속화).
# venv: /home/smith/imagegen/venv (vLLM-Omni). 앱은 generate_image 도구가
# LiteLLM flux2-klein 모델로 호출.
# 보안·바인딩 원칙은 qwen-serve.sh 헤더 참고 (VLLM_API_KEY env / VLLM_BIND_HOST Tailscale).
export CUDA_HOME=/usr/local/cuda-13.0
export PATH="/home/smith/imagegen/venv/bin:$CUDA_HOME/bin:$PATH"
export LD_LIBRARY_PATH="$CUDA_HOME/lib64:${LD_LIBRARY_PATH:-}"

set -a; [ -f /home/smith/vllm/vllm.env ] && . /home/smith/vllm/vllm.env; set +a

VLLM_BIND_HOST="${VLLM_BIND_HOST:-127.0.0.1}"
if [ "$VLLM_BIND_HOST" != "127.0.0.1" ] && [ "$VLLM_BIND_HOST" != "0.0.0.0" ]; then
  for i in $(seq 1 60); do
    ip -4 addr show 2>/dev/null | grep -q "inet ${VLLM_BIND_HOST}/" && break
    echo "[bind-wait] waiting for ${VLLM_BIND_HOST} ($i/60)"; sleep 2
  done
fi

exec vllm serve \
  black-forest-labs/FLUX.2-klein-9B \
  --omni \
  --port 8005 \
  --host "$VLLM_BIND_HOST" \
  --served-model-name flux2-klein
