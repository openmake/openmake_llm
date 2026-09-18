/**
 * 켜진 통합형 add-on 의 채팅 턴 통합을 모아 Base 확장점에 넘긴다 (2026-09-19).
 * Base(`services/chat-service/turn-integrations.ts`)는 이 함수만 부른다 — 개별 add-on 모듈을 알지 않는다.
 * 순서는 레지스트리 순서다(첫 턴 tool_choice 강제처럼 "첫 건이 이기는" 훅의 우선순위).
 *
 * @module addon-host/chat-integrations
 */
import type { ChatTurnIntegration } from '../services/chat-service/turn-integrations';
import { BUILTIN_ADDON_IDS, isBuiltinAddonEnabled, type BuiltinAddonId } from './builtin-registry';

const LOADERS: Readonly<Partial<Record<BuiltinAddonId, () => ChatTurnIntegration>>> = {
    'notebooklm': () => (require('../addons/notebooklm/chat-integration') as typeof import('../addons/notebooklm/chat-integration')).notebooklmChatIntegration,
    'discussion': () => (require('../addons/discussion/chat-integration') as typeof import('../addons/discussion/chat-integration')).discussionChatIntegration,
    'kakao-map': () => (require('../addons/kakao-map/chat-integration') as typeof import('../addons/kakao-map/chat-integration')).kakaoMapChatIntegration,
};

export function loadEnabledChatIntegrations(): ChatTurnIntegration[] {
    const out: ChatTurnIntegration[] = [];
    for (const id of BUILTIN_ADDON_IDS) {
        const load = LOADERS[id];
        if (load && isBuiltinAddonEnabled(id)) out.push(load());
    }
    return out;
}
