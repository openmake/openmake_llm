#!/usr/bin/env bash
# ============================================================
# bge-m3 — multilingual embedding (pooling runner) @ :8003
# ============================================================
# 운영 서버(rockyhan) 실측 serve 명령 기준 (2026-05-29 동기화).
# venv: /home/smith/vllm/vllm_env (embedding 전용 — qwen 과 별도 venv)
set -euo pipefail

MODEL_DIR="${BGE_MODEL_DIR:-/home/smith/models/bge-m3}"

exec vllm serve "$MODEL_DIR" \
  --runner pooling \
  --port 8003 \
  --host 127.0.0.1 \
  --served-model-name bge-m3 \
  --enforce-eager \
  --gpu-memory-utilization 0.15 \
  --api-key "${VLLM_API_KEY:-sk-vllm}"
