/**
 * 메모리 학습(memoryLearning) 정책 판정 — 서버 저장 설정이 authority.
 *
 * 배경 (2026-09-06): 설정 → 개인정보 "장기 기억" 토글은 `users.preferences.memoryLearning` 에
 * 저장되지만, 채팅 경로는 클라이언트가 메시지에 실어 보낸 플래그만 봤다(WS 는 신뢰,
 * REST 는 안 읽어 항상 ON, 에이전트 작업은 토글 자체를 안 봄). 사용자가 껐는데 REST·
 * 에이전트 작업에서 메모리 주입·자동 저장이 계속되는 프라이버시 결함.
 *
 * 규칙: 서버 설정 false 면 무조건 OFF. 서버 설정이 없거나 true 면 클라이언트 플래그가
 * 명시 false 일 때만 OFF(클라이언트는 더 제한할 수만 있고 켤 수는 없다). 조회 실패는
 * fail-open(클라이언트 플래그 기준) — 설정 조회 장애가 채팅을 막지 않는다.
 *
 * @module services/chat-service/memory-policy
 */
import { createLogger } from '../../utils/logger';

const logger = createLogger('MemoryPolicy');

/** PURE: 서버 저장값 + 클라이언트 플래그 → 유효 memoryLearning. */
export function effectiveMemoryLearning(serverPref: unknown, clientFlag?: boolean): boolean {
    if (serverPref === false) return false;
    return clientFlag !== false;
}

/**
 * userId 의 저장 설정을 읽어 유효 memoryLearning 을 돌려준다. guest 는 항상 false
 * (메모리 자체가 인증 사용자 전용).
 */
export async function resolveMemoryLearning(userId: string | undefined, clientFlag?: boolean): Promise<boolean> {
    if (!userId || userId === 'guest') return false;
    try {
        const { UserRepository } = await import('../../data/repositories/user-repository');
        const { getPool } = await import('../../data/models/unified-database');
        const prefs = await new UserRepository(getPool()).getPreferences(userId);
        return effectiveMemoryLearning(prefs.memoryLearning, clientFlag);
    } catch (e) {
        logger.warn('memoryLearning 설정 조회 실패 — 클라이언트 플래그로 폴백:', e);
        return effectiveMemoryLearning(undefined, clientFlag);
    }
}
