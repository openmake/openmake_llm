/**
 * discord add-on (웹) — 시스템 설정의 봇 설정 그룹과 API 키 스코프 프리셋.
 *
 * ⚠️ 프리셋은 두 스코프다 — 봇이 같은 키로 설정 수신(/api/integrations/discord/runtime-config, discord)과
 * 추론 호출(/api/v1/chat/completions, chat)을 모두 하기 때문. 하나만 주면 다른 쪽이 조용히 실패한다.
 */
import { MessageSquare } from "lucide-react";
import type { WebAddon } from "../types";

export const discordAddon: WebAddon = {
  id: "discord",
  settingsGroups: [{ group: "discord", Icon: MessageSquare }],
  apiKeyScopePresets: [{ id: "discord", scopes: ["chat", "discord"] }],
};
