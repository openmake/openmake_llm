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

/**
 * Agent Task 실행 직전 user MCP 풀 보장.
 *
 * 채팅 경로(emitChatStart)와 달리 **반드시 await 해야 한다** — 에이전트 작업은 일회성이라
 * 도구 목록을 모으는 시점에 풀이 비어 있으면 그 실행 내내 user MCP 도구가 없는 상태로
 * 진행된다. 실제로 mcp_list_tools 가 "설치된 외부 MCP 서버가 없습니다" 를 반환해 모델이
 * 서버 미설치로 오판하고 작업을 포기했다(채팅을 먼저 한 뒤 실행하면 우연히 성공하던 이유).
 *
 * ensureUserServers 는 safeSpawn 멱등 가드가 있어 이미 살아있는 클라이언트는 재spawn 하지 않는다.
 */
export async function ensureUserMcpForTask(userId: string, taskId: string): Promise<void> {
    const sv = getLifecycleSupervisor();
    if (!sv) return;
    try { await sv.ensureUserServers(userId, `task=${taskId}`); }
    catch (e) { logger.warn(`ensureUserMcpForTask 실패 u=${userId} t=${taskId}`, e); }
}

export async function emitChatEnd(userId: string, chatId: string): Promise<void> {
    const sv = getLifecycleSupervisor();
    if (!sv) return;
    try { await sv.onChatEnd(userId, chatId); }
    catch (e) { logger.warn(`onChatEnd hook 실패 u=${userId} c=${chatId}`, e); }
}
