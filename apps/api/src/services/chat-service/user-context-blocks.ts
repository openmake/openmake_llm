/**
 * Cross-conversation Memory(/remember) + Custom Instructions 블록 조립 —
 * message-pipeline 에서 분리 (파일 크기 가드).
 * strategy 경로·외부 provider 경로 양쪽에서 동일 호출 (claude.ai Memory/CI 동등).
 * 인증 사용자만 적용(guest 미적용), 각 조회 실패는 빈 블록 graceful fallback.
 * @module services/chat-service/user-context-blocks
 */
import { createLogger } from '../../utils/logger';
import { estimateTokens } from '../../llm/model-pool';
import { USER_CONTEXT_LIMITS } from '../../config/runtime-limits';

const logger = createLogger('UserContextBlocks');

/**
 * Semantic tier — 사용자 cross-conversation 메모리 블록('' 이면 미주입). 토큰 cap 적용.
 * 채팅(buildUserContextBlocks)과 Agent Task(system 조립) 양쪽에서 재사용(#3 3-tier 배선).
 * 실패 시 '' graceful. 인증 사용자만(guest 는 호출부에서 걸러짐).
 */
export async function buildUserMemoryBlock(userId: string): Promise<string> {
    try {
        const { UserMemoryRepository } = await import('../../data/repositories/user-memory-repository');
        const { getPool } = await import('../../data/models/unified-database');
        const memRepo = new UserMemoryRepository(getPool());
        const memories = await memRepo.listActiveByUser(userId, 50);
        if (memories.length === 0) return '';
        const maxMem = USER_CONTEXT_LIMITS.MAX_MEMORY_TOKENS;
        const kept: typeof memories = [];
        let usedTokens = 0;
        for (const m of memories) {
            const t = estimateTokens(m.content) + 4;
            if (usedTokens + t > maxMem && kept.length > 0) break;
            kept.push(m);
            usedTokens += t;
        }
        if (kept.length < memories.length) {
            logger.info(`user_memories 토큰 cap 적용 (${kept.length}/${memories.length}, >${maxMem} tok)`);
        }
        const lines = kept.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
        void memRepo.touchAccessed(kept.map((m) => m.id)).catch((e) => logger.warn('memory touch 실패 (무시):', e));
        return `## 🧠 User Memory (cross-conversation)\n${lines}\n\n---\n\n`;
    } catch (e) {
        logger.warn('user_memories 조회 실패 (계속 진행):', e);
        return '';
    }
}

export async function buildUserContextBlocks(
    userId: string | undefined,
    includeMemory = true,
): Promise<{ memoryBlock: string; customInstructionsBlock: string }> {
    let customInstructionsBlock = '';
    let memoryBlock = '';
    if (userId && userId !== 'guest') {
        try {
            const { UserRepository } = await import('../../data/repositories/user-repository');
            const { getPool } = await import('../../data/models/unified-database');
            const userRepo = new UserRepository(getPool());
            const ci = await userRepo.getCustomInstructions(userId);
            if (ci && ci.trim().length > 0) {
                // 토큰 cap — 매 턴 고정 비용이므로 무제한 prepend 방지 (head 보존 truncate)
                let ciText = ci.trim();
                const maxCi = USER_CONTEXT_LIMITS.MAX_CUSTOM_INSTRUCTIONS_TOKENS;
                if (estimateTokens(ciText) > maxCi) {
                    const ratio = ciText.length / estimateTokens(ciText);
                    ciText = ciText.slice(0, Math.floor(maxCi * ratio)).trimEnd() + ' …(생략됨)';
                    logger.info(`custom_instructions 토큰 cap 적용 (>${maxCi})`);
                }
                customInstructionsBlock = `## 👤 User Custom Instructions\n${ciText}\n\n---\n\n`;
            }
        } catch (e) {
            logger.warn('custom_instructions 조회 실패 (계속 진행):', e);
        }

        // includeMemory=false (설정 "장기 기억" 토글 OFF) → 저장된 메모리를 대화에 주입하지 않음.
        if (includeMemory) {
            memoryBlock = await buildUserMemoryBlock(userId);
        }
    }
    return { memoryBlock, customInstructionsBlock };
}
