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
import { getUnifiedDatabase, UserMemory, MemoryCategory } from '../data/models/unified-database';

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

/**
 * 장기 메모리 서비스 클래스
 */
export class MemoryService {
    private db = getUnifiedDatabase();

    /**
     * 대화에서 중요 정보를 추출하여 메모리에 저장
     */
    async extractAndSaveMemories(
        userId: string,
        sessionId: string,
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
                console.error('[MemoryService] LLM 추출 실패:', e);
            }
        }

        // 규칙 기반 추출 (폴백)
        const ruleBasedMemories = this.extractByRules(userMessage, assistantResponse);
        extracted.push(...ruleBasedMemories);

        // 중복 제거 및 저장
        const uniqueMemories = this.deduplicateMemories(extracted);
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
        return id;
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
     * 쿼리와 관련된 메모리 검색
     */
    async getRelevantMemories(userId: string, query: string, limit: number = 10): Promise<UserMemory[]> {
        return await this.db.getRelevantMemories(userId, query, limit);
    }

    /**
     * 채팅 컨텍스트용 메모리 문자열 생성
     */
    async buildMemoryContext(userId: string, currentQuery: string): Promise<MemoryContext> {
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

        for (const [category, mems] of Object.entries(grouped)) {
            const label = categoryLabels[category as MemoryCategory] || category;
            contextParts.push(`\n### ${label}`);
            for (const m of mems) {
                contextParts.push(`- **${m.key}**: ${m.value}`);
            }
        }

        contextParts.push('\n---\nUse this context to personalize your response.\n');

        return {
            memories,
            contextString: contextParts.join('\n')
        };
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
            // JSON 배열 추출
            const jsonMatch = llmResult.match(/\[[\s\S]*\]/);
            if (!jsonMatch) return [];

            const parsed = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(parsed)) return [];

            return parsed.filter(item =>
                item.category && item.key && item.value &&
                ['preference', 'fact', 'project', 'relationship', 'skill', 'context'].includes(item.category)
            ).map(item => ({
                category: item.category as MemoryCategory,
                key: String(item.key).slice(0, 100),
                value: String(item.value).slice(0, 1000),
                importance: Math.min(1, Math.max(0.1, Number(item.importance) || 0.5)),
                tags: Array.isArray(item.tags) ? item.tags.slice(0, 5) : []
            }));
        } catch (e) {
            console.error('[MemoryService] JSON 파싱 실패:', e);
            return [];
        }
    }

    private extractByRules(userMessage: string, assistantResponse: string): MemoryExtractionResult[] {
        const results: MemoryExtractionResult[] = [];
        const msg = userMessage.toLowerCase();

        // 이름 추출
        const namePatterns = [
            /제 이름은 (.+?)(?:입니다|이에요|야|예요|라고 해요)/i,
            /저는 (.+?)(?:라고 합니다|입니다)/i,
            /my name is (\w+)/i,
            /i'm (\w+)/i,
            /i am (\w+)/i
        ];
        for (const pattern of namePatterns) {
            const match = userMessage.match(pattern);
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
            const match = userMessage.match(pattern);
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
                const match = userMessage.match(pattern);
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
                const match = userMessage.match(pattern);
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
}

// 싱글톤 인스턴스
let memoryServiceInstance: MemoryService | null = null;

export function getMemoryService(): MemoryService {
    if (!memoryServiceInstance) {
        memoryServiceInstance = new MemoryService();
    }
    return memoryServiceInstance;
}
