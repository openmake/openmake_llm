/**
 * 임베딩 키 거절 메모 — 공급자가 사용자 키를 거절(401·무효 키 본문)하면 (사용자, 공급자) 를 TTL 동안 기억해
 * 그 사이의 수집·검색·선검사가 공급자를 다시 부르지 않고 같은 코드로 실패하게 한다(무효 키 시도를 세어 차단하는 공급자 대책).
 * 프로세스 메모리라 재시작하면 비워진다(그 뒤 최대 1회 호출로 다시 쌓인다). 키 재등록은 add-on 이 알 수 없어 TTL 로 푼다.
 *
 * @module addons/knowledge-runtime/embedding/key-rejection-memo
 */
import { createLogger } from '../../../utils/logger';
import { KNOWLEDGE_RUNTIME } from '../constants';

const logger = createLogger('KnowledgeEmbed');

/** `${userId}\u0000${providerId}` → 기록 시각(ms) */
const rejectedAt = new Map<string, number>();

const keyOf = (userId: string, providerId: string): string => `${userId}\u0000${providerId}`;

/** 거절을 기록한다 — 만료된 항목도 함께 비운다(크기가 사용자×공급자 수를 넘지 않게) */
export function noteKeyRejected(userId: string, providerId: string, now: number = Date.now()): void {
    for (const [k, at] of rejectedAt) if (now - at >= KNOWLEDGE_RUNTIME.EMBED_KEY_REJECT_MEMO_MS) rejectedAt.delete(k);
    rejectedAt.set(keyOf(userId, providerId), now);
    logger.warn(`임베딩 키 거절 기록: user=${userId} provider=${providerId} — ${KNOWLEDGE_RUNTIME.EMBED_KEY_REJECT_MEMO_MS}ms 동안 호출하지 않는다`);
}

/** TTL 안에 거절 기록이 있는가 — 만료됐으면 지우고 false */
export function isKeyRejected(userId: string, providerId: string, now: number = Date.now()): boolean {
    const k = keyOf(userId, providerId);
    const at = rejectedAt.get(k);
    if (at === undefined) return false;
    if (now - at >= KNOWLEDGE_RUNTIME.EMBED_KEY_REJECT_MEMO_MS) {
        rejectedAt.delete(k);
        return false;
    }
    return true;
}

/** 테스트용 초기화 */
export function clearKeyRejectionMemo(): void {
    rejectedAt.clear();
}
