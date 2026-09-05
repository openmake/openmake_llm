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
            { temperature: MEMORY_EXTRACTION.temperature }, undefined, { think: false },
        );
        const raw = (r.content ?? '').trim();
        if (!raw || /^none$/im.test(raw)) return [];
        return raw
            .split('\n')
            .map((l) => l.replace(/^[-*\d.)\s"']+/, '').trim())
            .filter((l) => l.length >= MEMORY_EXTRACTION.minLen && !/^none$/i.test(l))
            // 결정적 형식 필터 — 질문에 대한 답변·계산 결과가 메모리로 새는 것을 차단(config 주석 참고).
            .filter((l) => MEMORY_EXTRACTION.llmLinePattern.test(l))
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

/** PURE: 어절에서 조사·어미를 반복 제거한 크루드 어간(빈 문자열이 되기 직전에서 멈춤). */
function stemToken(t: string): string {
    let cur = t;
    for (let i = 0; i < MEMORY_EXTRACTION.dupTokenStripRounds; i += 1) {
        const next = cur.replace(MEMORY_EXTRACTION.dupTokenSuffix, '');
        if (next === cur || next.length === 0) break;
        cur = next;
    }
    return cur;
}

/** PURE: 근접 중복 비교용 토큰 집합 — 주어 접두 제거 → 어절 분리 → 어간 추출 → 수식어·짧은 토큰 제외. */
function dupTokens(s: string): Set<string> {
    const body = norm(s).replace(/[()]/g, ' ').replace(MEMORY_EXTRACTION.dupSubjectPrefix, '');
    return new Set(
        body.split(/\s+/)
            .map(stemToken)
            .filter((t) => t.length >= MEMORY_EXTRACTION.dupTokenMinLen && !MEMORY_EXTRACTION.dupStopwords.has(t)),
    );
}

/** PURE: 토큰 집합 Jaccard 유사도(둘 다 비면 0). */
function tokenJaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter += 1;
    return inter / (a.size + b.size - inter);
}

/** PURE: 기존 메모리와 근접 중복인지(정규화 exact·부분포함, 또는 어미 변형을 넘는 토큰 유사도). */
export function isDuplicateMemory(content: string, existing: string[]): boolean {
    const n = norm(content);
    if (!n) return true;
    const tokens = dupTokens(content);
    return existing.some((e) => {
        const ne = norm(e);
        if (ne === n || ne.includes(n) || n.includes(ne)) return true;
        return tokenJaccard(tokens, dupTokens(e)) >= MEMORY_EXTRACTION.dupTokenSimilarity;
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
        // 개수 cap 은 active 기준, 중복 판정은 삭제(비활성) 행 포함 — 삭제한 문장의 재생성 차단(tombstone).
        const [count0, contents] = await Promise.all([
            repo.countActiveByUser(userId),
            repo.listKnownContentsByUser(userId),
        ]);
        let count = count0;
        let saved = 0;
        let droppedAtCap = 0;
        for (const c of candidates) {
            if (count >= MEMORY_EXTRACTION.maxCount) { droppedAtCap += 1; continue; }
            if (isDuplicateMemory(c, contents)) continue;
            // 034 스키마 정의대로: 휴리스틱("기억해줘" 명시 의도)=explicit, LLM 감지=candidate. batch 는 백필 전용.
            const source = heur.includes(c) ? 'explicit' : 'candidate';
            await repo.create(randomUUID(), userId, c, source);
            contents.push(c);
            count += 1;
            saved += 1;
        }
        if (saved > 0) logger.info(`[MemoryExtract] 자동 저장 ${saved}건 (user ${userId}, heur ${heur.length}/llm ${llm.length})`);
        // cap 도달로 버린 후보는 조용히 사라지지 않게 남긴다 — memory-report.sh 가 집계(퇴출 정책 도입 게이트).
        if (droppedAtCap > 0) logger.warn(`[MemoryExtract] cap ${MEMORY_EXTRACTION.maxCount} 도달 — 후보 ${droppedAtCap}건 폐기 (user ${userId})`);
    } catch (e) {
        logger.debug(`[MemoryExtract] 실패 — 무시: ${e instanceof Error ? e.message : e}`);
    }
}
