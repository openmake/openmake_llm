/**
 * 켜진 add-on 의 채팅 모드를 모아 Base 확장점에 넘긴다 (2026-09-19).
 * 순서가 우선순위다 — 한 요청에 여러 모드가 켜져 오면 앞선 모드가 턴을 가져간다(종전: 토론 > 딥리서치).
 *
 * @module addon-host/chat-modes
 */
import type { ChatModeExtension } from '../services/chat-service/chat-modes';
import { BUILTIN_ADDON_IDS, isBuiltinAddonEnabled, type BuiltinAddonId } from './builtin-registry';

const LOADERS: Readonly<Partial<Record<BuiltinAddonId, () => ChatModeExtension>>> = {
    'discussion': () => (require('../addons/discussion/chat-mode') as typeof import('../addons/discussion/chat-mode')).discussionChatMode,
    'deep-research': () => (require('../addons/deep-research/chat-mode') as typeof import('../addons/deep-research/chat-mode')).deepResearchChatMode,
};

export function loadEnabledChatModes(): ChatModeExtension[] {
    const out: ChatModeExtension[] = [];
    for (const id of BUILTIN_ADDON_IDS) {
        const load = LOADERS[id];
        if (load && isBuiltinAddonEnabled(id)) out.push(load());
    }
    return out;
}
