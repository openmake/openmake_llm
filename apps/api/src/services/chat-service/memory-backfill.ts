/**
 * 과거 대화 데이터 백필(#3 c) — 기존 conversation_messages 에서 사용자 메모리를 일회성 추출.
 * 사용자별 과거 세션의 user 메시지를 LLM 으로 분석해 지속적 사실을 뽑아 source='batch' 로 저장.
 * #3(b)의 추출·dedup·cap 을 그대로 재사용. dryRun 지원(대량 기록 전 품질 확인).
 * 세션 단위 병렬(제한 동시성) — 개별 세션 실패는 스킵.
 *
 * @module services/chat-service/memory-backfill
 */
import { getPool } from '../../data/models/unified-database';
import { UserMemoryRepository } from '../../data/repositories/user-memory-repository';
import { createClient } from '../../llm/client';
import { extractLLMMemories, isDuplicateMemory } from './memory-extraction';
import { MEMORY_EXTRACTION } from '../../config/memory-extraction';
import { parallelBatch } from '../../workflow/graph-engine';
import { createLogger } from '../../utils/logger';

const logger = createLogger('MemoryBackfill');

export interface BackfillResult {
    sessionsProcessed: number;
    candidateCount: number;
    fresh: string[];
    saved: number;
    skippedDup: number;
    dryRun: boolean;
}

/**
 * 사용자 과거 대화에서 메모리 백필. dryRun=true 면 저장 없이 추출 후보만 반환.
 */
export async function backfillUserMemories(
    userId: string,
    opts: { dryRun?: boolean; maxSessions?: number; minChars?: number; concurrency?: number } = {},
): Promise<BackfillResult> {
    const { dryRun = false, maxSessions = 30, minChars = 40, concurrency = 3 } = opts;
    const pool = getPool();

    // 사용자 과거 세션의 user 메시지 병합(최근 우선).
    const rows = (await pool.query(
        `SELECT s.id, string_agg(m.content, E'\n' ORDER BY m.created_at) AS user_text
         FROM conversation_sessions s
         JOIN conversation_messages m ON m.session_id = s.id
         WHERE s.user_id = $1 AND m.role = 'user'
         GROUP BY s.id
         ORDER BY max(m.created_at) DESC
         LIMIT $2`,
        [userId, maxSessions],
    )).rows as Array<{ id: string; user_text: string }>;
    const sessions = rows.filter((r) => (r.user_text || '').length >= minChars);

    const client = createClient();
    const perSession = await parallelBatch(
        sessions,
        async (s) => extractLLMMemories(client, s.user_text),
        { concurrency },
    );
    const candidates = [...new Set((perSession.flat().filter(Boolean) as string[]))];

    const repo = new UserMemoryRepository(pool);
    const existing = (await repo.listActiveByUser(userId, MEMORY_EXTRACTION.maxCount)).map((m) => m.content);
    const fresh: string[] = [];
    let skippedDup = 0;
    for (const c of candidates) {
        if (isDuplicateMemory(c, [...existing, ...fresh])) { skippedDup += 1; continue; }
        fresh.push(c);
    }

    let saved = 0;
    if (!dryRun && fresh.length > 0) {
        const { randomUUID } = await import('node:crypto');
        let count = existing.length;
        for (const c of fresh) {
            if (count >= MEMORY_EXTRACTION.maxCount) break;
            await repo.create(randomUUID(), userId, c, 'batch');
            count += 1;
            saved += 1;
        }
        logger.info(`[Backfill] user ${userId}: ${saved} 저장 (세션 ${sessions.length}, 후보 ${candidates.length}, 중복 ${skippedDup})`);
    }

    return { sessionsProcessed: sessions.length, candidateCount: candidates.length, fresh, saved, skippedDup, dryRun };
}
