#!/usr/bin/env bash
set -euo pipefail
exec vllm serve Qwen/Qwen2.5-7B-Instruct \
  --port 8001 \
  --api-key "${VLLM_API_KEY:-sk-vllm}" \
  --enable-auto-tool-choice \
  --tool-call-parser hermes \
  --max-model-len 32768
