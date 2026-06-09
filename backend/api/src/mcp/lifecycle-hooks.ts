/**
 * Lifecycle hooks — auth + chat 이벤트를 MCPLifecycleSupervisor 로 위임.
 *
 * 안전성:
 *   - supervisor 미초기화 시 silent skip (서버 부팅 직후 또는 테스트 환경)
 *   - hook 실패는 logger.warn 만 — 인증/채팅 흐름을 막지 않음 (graceful)
 *
 */
import { getLifecycleSupervisor } from './lifecycle-supervisor';
import { createLogger } from '../utils/logger';

const logger = createLogger('LifecycleHooks');

export async function emitUserLogin(userId: string): Promise<void> {
    const sv = getLifecycleSupervisor();
    if (!sv) return;
    try { await sv.onUserLogin(userId); }
    catch (e) { logger.warn(`onUserLogin hook 실패 u=${userId}`, e); }
}

export async function emitUserLogout(userId: string): Promise<void> {
    const sv = getLifecycleSupervisor();
    if (!sv) return;
    try { await sv.onUserLogout(userId); }
    catch (e) { logger.warn(`onUserLogout hook 실패 u=${userId}`, e); }
}

export async function emitChatStart(userId: string, chatId: string): Promise<void> {
    const sv = getLifecycleSupervisor();
    if (!sv) return;
    try { await sv.onChatStart(userId, chatId); }
    catch (e) { logger.warn(`onChatStart hook 실패 u=${userId} c=${chatId}`, e); }
}

export async function emitChatEnd(userId: string, chatId: string): Promise<void> {
    const sv = getLifecycleSupervisor();
    if (!sv) return;
    try { await sv.onChatEnd(userId, chatId); }
    catch (e) { logger.warn(`onChatEnd hook 실패 u=${userId} c=${chatId}`, e); }
}
