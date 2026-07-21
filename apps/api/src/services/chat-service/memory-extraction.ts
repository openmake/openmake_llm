/**
 * 자동 기억형성(#3 b) — 대화에서 사용자 메모리를 자동 추출해 user_memories 에 저장.
 * ① 휴리스틱(무-LLM): 명시적 저장 의도 패턴. ② LLM 추출: 지속적 사실(플래그·대화당 1콜).
 * 추출 즉시 active(자동 주입). dedup + 개수 cap. fire-and-forget — 절대 throw 하지 않음(응답 무영향).
 *
 * @module services/chat-service/memory-extraction
 */
import { randomUUID } from 'node:crypto';
import { MEMORY_EXTRACTION, getMemoryExtractionMessages } from '../../config/memory-extraction';
import type { LLMClient } from '../../llm/client';
import { createLogger } from '../../utils/logger';

const logger = createLogger('MemoryExtraction');

/** PURE: 휴리스틱 추출 — 명시적 저장 의도 문장에서 메모리 콘텐츠 후보(중복 제거). */
export function extractHeuristicMemories(text: string): string[] {
    const t = (text || '').trim();
    if (!t) return [];
    const found: string[] = [];
    for (const p of MEMORY_EXTRACTION.heuristicPatterns) {
        const m = t.match(p.re);
        if (!m) continue;
        const c = (m[p.group] || m[0] || '').trim().replace(/\s+/g, ' ');
        if (c.length >= MEMORY_EXTRACTION.minLen) found.push(c.slice(0, MEMORY_EXTRACTION.maxLen));
    }
    return [...new Set(found)];
}

/** LLM 추출 — user 메시지에서 지속적 사실. 실패/빈 결과 시 []. */
export async function extractLLMMemories(client: LLMClient, text: string): Promise<string[]> {
    try {
        const { system, user } = getMemoryExtractionMessages(text);
        const r = await client.chat(
            [{ role: 'system', content: system }, { role: 'user', content: user }],
            { temperature: 0 }, undefined, { think: false },
        );
        const raw = (r.content ?? '').trim();
        if (!raw || /^none$/im.test(raw)) return [];
        return raw
            .split('\n')
            .map((l) => l.replace(/^[-*\d.)\s"']+/, '').trim())
            .filter((l) => l.length >= MEMORY_EXTRACTION.minLen && !/^none$/i.test(l))
            .slice(0, MEMORY_EXTRACTION.llmMaxPerMessage)
            .map((l) => l.slice(0, MEMORY_EXTRACTION.maxLen));
    } catch (e) {
        logger.debug(`LLM 추출 실패 — 스킵: ${e instanceof Error ? e.message : e}`);
        return [];
    }
}

/** PURE: 정규화 문자열. */
function norm(s: string): string {
    return s.toLowerCase().replace(/[.,!?~]/g, '').replace(/\s+/g, ' ').trim();
}

/** PURE: 기존 메모리와 근접 중복인지(정규화 exact 또는 부분포함). */
export function isDuplicateMemory(content: string, existing: string[]): boolean {
    const n = norm(content);
    if (!n) return true;
    return existing.some((e) => {
        const ne = norm(e);
        return ne === n || ne.includes(n) || n.includes(ne);
    });
}

/**
 * 오케스트레이터 — user 메시지에서 자동 기억형성. 비차단·비throw(fire-and-forget 로 호출).
 * 플래그 OFF·guest·후보 없음·cap 초과 시 no-op.
 */
export async function autoFormMemories(params: { userId?: string; message: string; client?: LLMClient }): Promise<void> {
    const { userId, message, client } = params;
    if (!userId || userId === 'guest') return;
    if (!MEMORY_EXTRACTION.heuristicEnabled && !MEMORY_EXTRACTION.llmEnabled) return;
    try {
        const heur = MEMORY_EXTRACTION.heuristicEnabled ? extractHeuristicMemories(message) : [];
        const llm = MEMORY_EXTRACTION.llmEnabled && client ? await extractLLMMemories(client, message) : [];
        const candidates = [...new Set([...heur, ...llm])];
        if (candidates.length === 0) return;

        const { UserMemoryRepository } = await import('../../data/repositories/user-memory-repository');
        const { getPool } = await import('../../data/models/unified-database');
        const repo = new UserMemoryRepository(getPool());
        const existing = await repo.listActiveByUser(userId, MEMORY_EXTRACTION.maxCount);
        const contents = existing.map((m) => m.content);
        let count = existing.length;
        let saved = 0;
        for (const c of candidates) {
            if (count >= MEMORY_EXTRACTION.maxCount) break;
            if (isDuplicateMemory(c, contents)) continue;
            const source = heur.includes(c) ? 'candidate' : 'batch';
            await repo.create(randomUUID(), userId, c, source);
            contents.push(c);
            count += 1;
            saved += 1;
        }
        if (saved > 0) logger.info(`[MemoryExtract] 자동 저장 ${saved}건 (user ${userId}, heur ${heur.length}/llm ${llm.length})`);
    } catch (e) {
        logger.debug(`[MemoryExtract] 실패 — 무시: ${e instanceof Error ? e.message : e}`);
    }
}
