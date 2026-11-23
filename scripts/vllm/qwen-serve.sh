#!/usr/bin/env bash
set -euo pipefail
# Flash-Next uses the GPU runtime provided by the DGX Compose stack.
vllm_home="${VLLM_HOME:-$HOME/vllm}"
cd "$vllm_home"
exec docker compose -f compose.yml -f compose.flash.yml up -d vllm-chat
