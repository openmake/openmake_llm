/**
 * ============================================================
 * MemoryService - 장기 메모리 관리 서비스
 * ============================================================
 * 
 * 사용자별 장기 기억을 저장, 검색, 활용하는 서비스입니다.
 * - 대화에서 중요 정보 자동 추출
 * - 관련 메모리 검색 및 컨텍스트 주입
 * - 메모리 중요도 관리
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'node:crypto';
import { getUnifiedDatabase, UserMemory, MemoryCategory } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';
import { CAPACITY, TRUNCATION, DISCUSSION_TOKEN_BUDGET } from '../config/runtime-limits';

const logger = createLogger('MemoryService');

export interface MemoryExtractionResult {
    category: MemoryCategory;
    key: string;
    value: string;
    importance: number;
    tags: string[];
}

export interface MemoryContext {
    memories: UserMemory[];
    contextString: string;
}

/** 메모리 컨텍스트 캐시 엔트리 */
interface MemoryCacheEntry {
    context: MemoryContext;
    cachedAt: number;
}

/** 캐시 TTL (5분) */
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;
/** 캐시 최대 크기 */
const MEMORY_CACHE_MAX_SIZE = 200;

/**
 * 장기 메모리 서비스 클래스
 */
export class MemoryService {
    private db = getUnifiedDatabase();
    private static readonly REGEX_SAFE_INPUT_MAX_LENGTH = CAPACITY.REGEX_SAFE_INPUT_MAX_LENGTH;
    /** 세션별 메모리 컨텍스트 캐시 (key: userId:queryHash) */
    private memoryCache = new Map<string, MemoryCacheEntry>();

    /**
     * 대화에서 중요 정보를 추출하여 메모리에 저장
     */
    async extractAndSaveMemories(
        userId: string,
        sessionId: string | null,
        userMessage: string,
        assistantResponse: string,
        llmExtractor?: (prompt: string) => Promise<string>
    ): Promise<MemoryExtractionResult[]> {
        const extracted: MemoryExtractionResult[] = [];

        // LLM을 사용한 메모리 추출 (옵션)
        if (llmExtractor) {
            try {
                const extractionPrompt = this.buildExtractionPrompt(userMessage, assistantResponse);
                const llmResult = await llmExtractor(extractionPrompt);
                const parsed = this.parseExtractionResult(llmResult);
                extracted.push(...parsed);
            } catch (e) {
                logger.error('LLM 추출 실패:', e);
            }
        }

        // 규칙 기반 추출 (폴백)
        const ruleBasedMemories = this.extractByRules(userMessage, assistantResponse);
        extracted.push(...ruleBasedMemories);

        // 중복 제거
        const uniqueMemories = this.deduplicateMemories(extracted);

        // 티어 한도 검증: 현재 메모리 수 확인 후 초과 시 최저 importance 교체
        if (uniqueMemories.length > 0) {
            const currentMemories = await this.getUserMemories(userId);
            const MEMORY_SOFT_LIMIT = 500; // 기본 상한 (티어별 분기는 routes에서 처리)
            const availableSlots = Math.max(0, MEMORY_SOFT_LIMIT - currentMemories.length);

            if (availableSlots < uniqueMemories.length) {
                // 저장 공간 부족 시: 새 메모리 중 importance 높은 것만 선택
                uniqueMemories.sort((a, b) => b.importance - a.importance);
                uniqueMemories.splice(availableSlots);
                logger.info(`메모리 한도 근접: ${availableSlots}개 슬롯만 사용 가능, ${uniqueMemories.length}개 저장`);
            }
        }

        for (const memory of uniqueMemories) {
            await this.saveMemory(userId, sessionId, memory);
        }

        return uniqueMemories;
    }

    /**
     * 메모리 저장
     */
    async saveMemory(
        userId: string,
        sessionId: string | null,
        memory: MemoryExtractionResult
    ): Promise<string> {
        const id = uuidv4();
        await this.db.createMemory({
            id,
            userId,
            category: memory.category,
            key: memory.key,
            value: memory.value,
            importance: memory.importance,
            sourceSessionId: sessionId || undefined,
            tags: memory.tags
        });
        this.invalidateCache(userId);

        // 임베딩 저장 (fire-and-forget, 시맨틱 검색용)
        this.saveMemoryEmbedding(id, memory.key, memory.value).catch(e => logger.debug('임베딩 저장 실패:', e?.message));

        return id;
    }

    /**
     * 메모리의 임베딩 벡터를 vector_embeddings 테이블에 저장합니다.
     * EmbeddingService가 사용 가능한 경우에만 동작합니다.
     */
    private async saveMemoryEmbedding(memoryId: string, key: string, value: string): Promise<void> {
        try {
            const { getEmbeddingService } = await import('../domains/rag/EmbeddingService');
            const embeddingService = getEmbeddingService();
            const text = `${key}: ${value}`;
            const embedding = await embeddingService.embedText(text);
            if (embedding && embedding.length > 0) {
                const pool = this.db.getPool();
                await pool.query(
                    `INSERT INTO vector_embeddings (source_type, source_id, chunk_index, content, embedding)
                     VALUES ('memory', $1, 0, $2, $3)
                     ON CONFLICT DO NOTHING`,
                    [memoryId, text, JSON.stringify(embedding)]
                );
            }
        } catch (e) {
            logger.debug('메모리 임베딩 저장 실패 (무시):', e instanceof Error ? e.message : e);
        }
    }

    /**
     * 사용자의 모든 메모리 조회
     */
    async getUserMemories(userId: string, options?: {
        category?: MemoryCategory;
        limit?: number;
        minImportance?: number;
    }): Promise<UserMemory[]> {
        return await this.db.getUserMemories(userId, options);
    }

    /**
     * 쿼리와 관련된 메모리 검색 (하이브리드: 키워드 + 시맨틱)
     */
    async getRelevantMemories(userId: string, query: string, limit: number = 10): Promise<UserMemory[]> {
        // 1) 키워드 기반 검색 (기존)
        const keywordResults = await this.db.getRelevantMemories(userId, query, limit);

        // 2) 시맨틱 검색 시도 (EmbeddingService 사용 가능 시)
        try {
            const { getEmbeddingService } = await import('../domains/rag/EmbeddingService');
            const embeddingService = getEmbeddingService();
            const queryEmbedding = await embeddingService.embedText(query);

            if (queryEmbedding && queryEmbedding.length > 0) {
                const pool = this.db.getPool();
                const { MemoryRepository } = await import('../data/repositories/memory-repository');
                const memRepo = new MemoryRepository(pool);
                const semanticIds = await memRepo.getSemanticMemoryIds(queryEmbedding, userId, limit);

                // 키워드 결과에 없는 시맨틱 결과를 병합
                const existingIds = new Set(keywordResults.map(m => m.id));
                const newIds = semanticIds.filter(id => !existingIds.has(id));

                if (newIds.length > 0) {
                    const allMemories = await this.getUserMemories(userId);
                    const semanticMemories = allMemories.filter(m => newIds.includes(m.id));
                    keywordResults.push(...semanticMemories);
                    // importance 순 재정렬 후 limit 적용
                    keywordResults.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
                    keywordResults.splice(limit);
                }
            }
        } catch {
            // 시맨틱 검색 실패 시 키워드 결과만 반환 (graceful degradation)
        }

        return keywordResults;
    }

    /**
     * 캐시 무효화 (메모리 저장/삭제 시 호출)
     * userId로 시작하는 모든 캐시 키를 제거합니다.
     */
    private invalidateCache(userId: string): void {
        const prefix = `${userId}:`;
        for (const key of this.memoryCache.keys()) {
            if (key.startsWith(prefix)) {
                this.memoryCache.delete(key);
            }
        }
    }

    /** 쿼리 문자열의 짧은 해시를 생성합니다 */
    private queryHash(query: string): string {
        return crypto.createHash('md5').update(query).digest('hex').slice(0, 8);
    }

    /**
     * 채팅 컨텍스트용 메모리 문자열 생성
     * @param maxTokens - 메모리 컨텍스트에 할당할 최대 토큰 수 (기본: DISCUSSION_TOKEN_BUDGET.DEFAULT.maxMemoryTokens)
     */
    async buildMemoryContext(userId: string, currentQuery: string, maxTokens?: number): Promise<MemoryContext> {
        // 캐시 확인 (userId + 쿼리 해시로 구분)
        const cacheKey = `${userId}:${this.queryHash(currentQuery)}`;
        const cached = this.memoryCache.get(cacheKey);
        if (cached && Date.now() - cached.cachedAt < MEMORY_CACHE_TTL_MS) {
            return cached.context;
        }

        const tokenBudget = maxTokens ?? DISCUSSION_TOKEN_BUDGET.DEFAULT.maxMemoryTokens;
        // 토큰 ≈ 문자수 / 3 (한국어 기준 보수적 추정)
        const charBudget = tokenBudget * 3;

        const memories = await this.getRelevantMemories(userId, currentQuery, 10);

        if (memories.length === 0) {
            return { memories: [], contextString: '' };
        }

        const contextParts: string[] = ['## 🧠 User Memory Context'];
        
        // 카테고리별 그룹화
        const grouped: Record<string, UserMemory[]> = {};
        for (const m of memories) {
            if (!grouped[m.category]) grouped[m.category] = [];
            grouped[m.category].push(m);
        }

        const categoryLabels: Record<MemoryCategory, string> = {
            preference: '선호도',
            fact: '사실 정보',
            project: '프로젝트',
            relationship: '관계',
            skill: '기술/역량',
            context: '컨텍스트'
        };

        let usedChars = 0;
        const includedMemories: UserMemory[] = [];

        for (const [category, mems] of Object.entries(grouped)) {
            const label = categoryLabels[category as MemoryCategory] || category;
            const headerLine = `\n### ${label}`;
            usedChars += headerLine.length;
            if (usedChars > charBudget) break;
            contextParts.push(headerLine);

            for (const m of mems) {
                const line = `- **${m.key}**: ${m.value}`;
                if (usedChars + line.length > charBudget) break;
                usedChars += line.length;
                contextParts.push(line);
                includedMemories.push(m);
            }
        }

        contextParts.push('\n---\nUse this context to personalize your response.\n');

        const result: MemoryContext = {
            memories: includedMemories.length > 0 ? includedMemories : memories,
            contextString: contextParts.join('\n')
        };

        // 캐시 저장 (크기 제한 + 만료 엔트리 정리)
        if (this.memoryCache.size >= MEMORY_CACHE_MAX_SIZE) {
            const now = Date.now();
            // 먼저 만료된 엔트리를 일괄 정리
            for (const [key, entry] of this.memoryCache) {
                if (now - entry.cachedAt >= MEMORY_CACHE_TTL_MS) {
                    this.memoryCache.delete(key);
                }
            }
            // 여전히 꽉 차면 가장 오래된 엔트리 제거
            if (this.memoryCache.size >= MEMORY_CACHE_MAX_SIZE) {
                const oldestKey = this.memoryCache.keys().next().value;
                if (oldestKey) this.memoryCache.delete(oldestKey);
            }
        }
        this.memoryCache.set(cacheKey, { context: result, cachedAt: Date.now() });

        return result;
    }

    /**
     * 같은 카테고리+키를 가진 유사 메모리를 통합합니다.
     * 주기적 배치 작업으로 호출 권장 (메모리 축적 후 정리).
     * @returns 통합으로 삭제된 메모리 수
     */
    async consolidateMemories(userId: string): Promise<number> {
        const allMemories = await this.getUserMemories(userId);
        if (allMemories.length < 2) return 0;

        // 카테고리별 그룹화
        const grouped: Record<string, UserMemory[]> = {};
        for (const m of allMemories) {
            const groupKey = m.category;
            if (!grouped[groupKey]) grouped[groupKey] = [];
            grouped[groupKey].push(m);
        }

        let deletedCount = 0;

        for (const mems of Object.values(grouped)) {
            if (mems.length < 2) continue;

            // 같은 카테고리 내에서 key가 동일한 메모리 병합
            const byKey: Record<string, UserMemory[]> = {};
            for (const m of mems) {
                const normKey = m.key.toLowerCase().trim();
                if (!byKey[normKey]) byKey[normKey] = [];
                byKey[normKey].push(m);
            }

            for (const sameKeyMems of Object.values(byKey)) {
                if (sameKeyMems.length < 2) continue;

                // importance가 가장 높은 메모리를 유지, 나머지 삭제
                sameKeyMems.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
                const keep = sameKeyMems[0];
                const toDelete = sameKeyMems.slice(1);

                // 삭제 대상의 값을 유지 메모리에 병합 (값이 다른 경우)
                const uniqueValues = new Set([keep.value]);
                for (const dup of toDelete) {
                    if (!uniqueValues.has(dup.value)) {
                        uniqueValues.add(dup.value);
                    }
                }
                const mergedValue = [...uniqueValues].join(' | ');
                if (mergedValue !== keep.value) {
                    await this.updateMemory(keep.id, { value: mergedValue.slice(0, TRUNCATION.MEMORY_VALUE_MAX) });
                }

                for (const dup of toDelete) {
                    await this.deleteMemory(dup.id);
                    deletedCount++;
                }
            }
        }

        if (deletedCount > 0) {
            this.invalidateCache(userId);
            logger.info(`메모리 통합 완료: ${deletedCount}개 중복 제거 (user=${userId})`);
        }

        return deletedCount;
    }

    /**
     * 메모리 업데이트
     */
    async updateMemory(memoryId: string, updates: { value?: string; importance?: number }): Promise<void> {
        await this.db.updateMemory(memoryId, updates);
    }

    /**
     * 메모리 삭제
     */
    async deleteMemory(memoryId: string): Promise<void> {
        await this.db.deleteMemory(memoryId);
    }

    /**
     * 사용자의 모든 메모리 삭제
     */
    async clearUserMemories(userId: string): Promise<void> {
        await this.db.deleteUserMemories(userId);
        this.invalidateCache(userId);
    }

    // ============================================
    // Private Methods
    // ============================================

    private buildExtractionPrompt(userMessage: string, assistantResponse: string): string {
        return `Analyze this conversation and extract important facts to remember about the user.

USER MESSAGE:
${userMessage}

ASSISTANT RESPONSE:
${assistantResponse}

Extract memories in this JSON format:
[
  {
    "category": "preference|fact|project|relationship|skill|context",
    "key": "short descriptive key",
    "value": "the information to remember",
    "importance": 0.1-1.0,
    "tags": ["relevant", "tags"]
  }
]

Categories:
- preference: User preferences (language, style, likes/dislikes)
- fact: Personal facts (name, job, location, etc.)
- project: Projects user is working on
- relationship: People or organizations mentioned
- skill: User's skills or expertise
- context: Ongoing context (current tasks, goals)

Only extract genuinely useful information. Return empty array [] if nothing significant.
Return ONLY the JSON array, no explanation.`;
    }

    private parseExtractionResult(llmResult: string): MemoryExtractionResult[] {
        try {
            const safeLlmResult = this.limitRegexInput(llmResult);
            // JSON 배열 추출
            const jsonMatch = safeLlmResult.match(/\[[\s\S]*\]/);
            if (!jsonMatch) return [];

            const parsed = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(parsed)) return [];

            return parsed.filter(item =>
                item.category && item.key && item.value &&
                ['preference', 'fact', 'project', 'relationship', 'skill', 'context'].includes(item.category)
            ).map(item => ({
                category: item.category as MemoryCategory,
                key: String(item.key).slice(0, TRUNCATION.MEMORY_KEY_MAX),
                value: String(item.value).slice(0, TRUNCATION.MEMORY_VALUE_MAX),
                importance: Math.min(1, Math.max(0.1, Number(item.importance) || 0.5)),
                tags: Array.isArray(item.tags) ? item.tags.slice(0, TRUNCATION.MEMORY_MAX_TAGS) : []
            }));
        } catch (e) {
            logger.error('JSON 파싱 실패:', e);
            return [];
        }
    }

    private extractByRules(userMessage: string, _assistantResponse: string): MemoryExtractionResult[] {
        const results: MemoryExtractionResult[] = [];
        const safeUserMessage = this.limitRegexInput(userMessage);
        const msg = safeUserMessage.toLowerCase();

        // 이름 추출
        const namePatterns = [
            /제 이름은 (.+?)(?:입니다|이에요|야|예요|라고 해요)/i,
            /저는 (.+?)(?:라고 합니다|입니다)/i,
            /my name is (\w+)/i,
            /i'm (\w+)/i,
            /i am (\w+)/i
        ];
        for (const pattern of namePatterns) {
            const match = safeUserMessage.match(pattern);
            if (match) {
                results.push({
                    category: 'fact',
                    key: '이름',
                    value: match[1].trim(),
                    importance: 0.9,
                    tags: ['personal', 'name']
                });
                break;
            }
        }

        // 직업 추출
        const jobPatterns = [
            /저는 (.+?)(?:로 일하고|에서 일하고|입니다|이에요)/i,
            /(?:직업은|직업이) (.+?)(?:입니다|이에요|야)/i,
            /i work as a (.+)/i,
            /i'm a (.+?) (?:at|in|for)/i
        ];
        for (const pattern of jobPatterns) {
            const match = safeUserMessage.match(pattern);
            if (match) {
                results.push({
                    category: 'fact',
                    key: '직업',
                    value: match[1].trim(),
                    importance: 0.8,
                    tags: ['personal', 'job', 'career']
                });
                break;
            }
        }

        // 선호도 추출
        if (msg.includes('좋아') || msg.includes('선호') || msg.includes('like') || msg.includes('prefer')) {
            const preferPatterns = [
                /(.+?)(?:를|을)? 좋아(?:해|합니다)/i,
                /(.+?)(?:를|을)? 선호(?:해|합니다)/i,
                /i (?:like|love|prefer) (.+)/i
            ];
            for (const pattern of preferPatterns) {
                const match = safeUserMessage.match(pattern);
                if (match && match[1].length < 50) {
                    results.push({
                        category: 'preference',
                        key: '선호',
                        value: match[1].trim(),
                        importance: 0.6,
                        tags: ['preference']
                    });
                    break;
                }
            }
        }

        // 프로젝트 관련
        if (msg.includes('프로젝트') || msg.includes('개발') || msg.includes('만들고') || msg.includes('작업')) {
            const projectPatterns = [
                /(.+?) (?:프로젝트|개발|작업)(?:을|를)? (?:하고|진행)/i,
                /(.+?)(?:을|를) 만들고/i
            ];
            for (const pattern of projectPatterns) {
                const match = safeUserMessage.match(pattern);
                if (match && match[1].length < 100) {
                    results.push({
                        category: 'project',
                        key: '현재 프로젝트',
                        value: match[1].trim(),
                        importance: 0.7,
                        tags: ['project', 'work']
                    });
                    break;
                }
            }
        }

        // 기술스택/도구 추출
        const techPatterns = [
            /(?:사용|쓰고|쓰는|배우고|공부하고).*?(?:있는|있어|중인).*?([\w\s.#+]+)/i,
            /i (?:use|work with|develop with|code in) ([\w\s.#+]+)/i,
        ];
        for (const pattern of techPatterns) {
            const match = safeUserMessage.match(pattern);
            if (match && match[1].trim().length > 1 && match[1].trim().length < 50) {
                results.push({
                    category: 'skill',
                    key: '기술스택',
                    value: match[1].trim(),
                    importance: 0.7,
                    tags: ['tech', 'skill']
                });
                break;
            }
        }

        // 위치/거주지 추출
        const locationPatterns = [
            /(?:살고|거주하고|살아요|위치해).*?(?:있는|있어|에)\s*(.+?)(?:에서|입니다|이에요|야)/i,
            /i (?:live|am based|am located) (?:in|at) (.+?)(?:\.|,|$)/i,
        ];
        for (const pattern of locationPatterns) {
            const match = safeUserMessage.match(pattern);
            if (match && match[1].trim().length < 50) {
                results.push({
                    category: 'fact',
                    key: '위치',
                    value: match[1].trim(),
                    importance: 0.6,
                    tags: ['personal', 'location']
                });
                break;
            }
        }

        // 목표/관심사 추출
        const goalPatterns = [
            /(.+?)(?:에 관심|을 목표|를 목표|하고 싶|배우고 싶)/i,
            /i want to (.+?)(?:\.|,|$)/i,
            /i'm interested in (.+?)(?:\.|,|$)/i,
        ];
        for (const pattern of goalPatterns) {
            const match = safeUserMessage.match(pattern);
            if (match && match[1].trim().length > 2 && match[1].trim().length < 100) {
                results.push({
                    category: 'context',
                    key: '목표/관심사',
                    value: match[1].trim(),
                    importance: 0.6,
                    tags: ['goal', 'interest']
                });
                break;
            }
        }

        // 조직/팀 추출
        const teamPatterns = [
            /(?:팀|회사|조직|부서)(?:은|는|이|가)?\s*(.+?)(?:입니다|이에요|야|예요|에서)/i,
            /i (?:work at|belong to|am part of|am on) (.+?)(?:\.|,|$)/i,
        ];
        for (const pattern of teamPatterns) {
            const match = safeUserMessage.match(pattern);
            if (match && match[1].trim().length > 1 && match[1].trim().length < 50) {
                results.push({
                    category: 'relationship',
                    key: '소속',
                    value: match[1].trim(),
                    importance: 0.7,
                    tags: ['organization', 'team']
                });
                break;
            }
        }

        // 일정/마감 추출
        const deadlinePatterns = [
            /(.+?)(?:까지|마감|데드라인|deadline)/i,
            /deadline (?:is|by) (.+?)(?:\.|,|$)/i,
            /due (?:by|on|date) (.+?)(?:\.|,|$)/i,
        ];
        for (const pattern of deadlinePatterns) {
            const match = safeUserMessage.match(pattern);
            if (match && match[1].trim().length > 2 && match[1].trim().length < 80) {
                results.push({
                    category: 'context',
                    key: '일정/마감',
                    value: match[1].trim(),
                    importance: 0.7,
                    tags: ['deadline', 'schedule']
                });
                break;
            }
        }

        // 언어 선호 추출
        if (msg.includes('영어') || msg.includes('한국어') || msg.includes('일본어') ||
            msg.includes('korean') || msg.includes('english') || msg.includes('japanese')) {
            const langPatterns = [
                /(?:답변|응답|대답).*?(한국어|영어|일본어|중국어|english|korean|japanese|chinese)/i,
                /(?:in|using) (english|korean|japanese|chinese)/i,
            ];
            for (const pattern of langPatterns) {
                const match = safeUserMessage.match(pattern);
                if (match) {
                    results.push({
                        category: 'preference',
                        key: '언어 선호',
                        value: match[1].trim(),
                        importance: 0.8,
                        tags: ['preference', 'language']
                    });
                    break;
                }
            }
        }

        return results;
    }

    private deduplicateMemories(memories: MemoryExtractionResult[]): MemoryExtractionResult[] {
        const seen = new Map<string, MemoryExtractionResult>();
        
        for (const mem of memories) {
            const key = `${mem.category}:${mem.key.toLowerCase()}`;
            const existing = seen.get(key);
            
            if (!existing || mem.importance > existing.importance) {
                seen.set(key, mem);
            }
        }

        return Array.from(seen.values());
    }

    private limitRegexInput(input: string): string {
        return input.length > MemoryService.REGEX_SAFE_INPUT_MAX_LENGTH
            ? input.substring(0, MemoryService.REGEX_SAFE_INPUT_MAX_LENGTH)
            : input;
    }
}

// 싱글톤 인스턴스
let memoryServiceInstance: MemoryService | null = null;

export function getMemoryService(): MemoryService {
    if (!memoryServiceInstance) {
        memoryServiceInstance = new MemoryService();
    }
    return memoryServiceInstance;
}
