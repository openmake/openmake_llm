/**
 * 켜진 add-on 의 채팅 모드를 모아 Base 확장점에 넘긴다 (2026-09-19).
 * 기여는 매니페스트 `entry.chatMode` 가 선언한다. 순서(매니페스트 `order`)가 우선순위다 — 한 요청에 여러 모드가
 * 켜져 오면 앞선 모드가 턴을 가져간다.
 *
 * @module addon-host/chat-modes
 */
import type { ChatModeExtension } from '../services/chat-service/chat-modes';
import { enabledBuiltinAddons } from './builtin-registry';
import { loadAddonEntry } from './entry-loader';

export function loadEnabledChatModes(): ChatModeExtension[] {
    return enabledBuiltinAddons()
        .filter(a => a.manifest.entry?.chatMode)
        .map(a => loadAddonEntry<ChatModeExtension>(a, a.manifest.entry!.chatMode!));
}
