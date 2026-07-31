// ============================================================
// DGX PM2 ecosystem 예시 — vLLM 전용 inference plane (2026-07-31)
// ============================================================
// 실물: DGX /home/smith/vllm/ecosystem.config.cjs
// systemd 는 `pm2-<user>.service` 하나만 사용 (구 openmake-*.service 3종 폐기).
// TAILSCALE_IP 는 실제 DGX Tailscale IPv4 로 치환 (공개 저장소에 실주소 기재 금지).
// vLLM API key 는 /home/smith/vllm/vllm.env(0600) 의 VLLM_API_KEY — 여기 쓰지 않는다.
const TAILSCALE_IP = "<VLLM_TAILSCALE_HOST>";

module.exports = {
  apps: [
    {
      name: "vllm-chat",
      script: "/home/smith/vllm/start_vllm.sh",
      cwd: "/home/smith/vllm",
      env: { VLLM_BIND_HOST: TAILSCALE_IP },
      out_file: "/home/smith/vllm/vllm.log",
      error_file: "/home/smith/vllm/vllm.log",
      merge_logs: true,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      min_uptime: "60s",
      kill_timeout: 30000,
      time: true,
    },
    {
      name: "vllm-embed",
      script: "/home/smith/vllm/start_vllm_embed.sh",
      cwd: "/home/smith/vllm",
      env: { VLLM_BIND_HOST: TAILSCALE_IP },
      out_file: "/home/smith/vllm/vllm-embed.log",
      error_file: "/home/smith/vllm/vllm-embed.log",
      merge_logs: true,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      min_uptime: "30s",
      kill_timeout: 30000,
      time: true,
    },
    {
      name: "flux",
      script: "/home/smith/imagegen/start_flux.sh",
      cwd: "/home/smith/imagegen",
      env: { VLLM_BIND_HOST: TAILSCALE_IP },
      out_file: "/home/smith/imagegen/flux.log",
      error_file: "/home/smith/imagegen/flux.log",
      merge_logs: true,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      min_uptime: "60s",
      kill_timeout: 30000,
      time: true,
    },
  ],
};
