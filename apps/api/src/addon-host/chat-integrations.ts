/**
 * 켜진 add-on 의 채팅 턴 통합을 모아 Base 확장점에 넘긴다 (2026-09-19).
 * Base(`services/chat-service/turn-integrations.ts`)는 이 함수만 부른다 — 개별 add-on 모듈을 알지 않는다.
 * 어떤 add-on 이 기여하는지는 매니페스트 `entry.chatIntegration` 이 선언하고, 순서는 매니페스트 `order` 다
 * (첫 턴 tool_choice 강제처럼 "첫 건이 이기는" 훅의 우선순위).
 *
 * @module addon-host/chat-integrations
 */
import type { ChatTurnIntegration } from '../services/chat-service/turn-integrations';
import { enabledBuiltinAddons } from './builtin-registry';
import { loadAddonEntry } from './entry-loader';

export function loadEnabledChatIntegrations(): ChatTurnIntegration[] {
    return enabledBuiltinAddons()
        .filter(a => a.manifest.entry?.chatIntegration)
        .map(a => loadAddonEntry<ChatTurnIntegration>(a, a.manifest.entry!.chatIntegration!));
}
