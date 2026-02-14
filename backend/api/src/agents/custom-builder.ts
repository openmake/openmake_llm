/**
 * 🆕 커스텀 에이전트 빌더
 * 사용자 정의 에이전트 생성, 복제, A/B 테스트
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { Agent } from './types';

/**
 * Sanitize agent ID to prevent path traversal attacks.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
export function sanitizeAgentId(name: string): string {
    const sanitized = name
        .toLowerCase()
        .replace(/[^a-z0-9가-힣_-]/g, '-')  // Allow Korean chars, alphanumeric, hyphens, underscores
        .replace(/-+/g, '-')                   // Collapse multiple hyphens
        .replace(/^-|-$/g, '')                 // Trim leading/trailing hyphens
        .substring(0, 50);                     // Length limit

    if (!sanitized || sanitized.length === 0) {
        throw new Error('Invalid agent name: results in empty ID after sanitization');
    }

    return sanitized;
}

/**
 * Validate that a resolved file path stays within the expected base directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 */
export function validatePathWithinDir(filePath: string, baseDir: string): void {
    const resolved = path.resolve(filePath);
    const base = path.resolve(baseDir);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        throw new Error('Path traversal attempt detected');
    }
}

const logger = createLogger('CustomAgentBuilder');

// 커스텀 에이전트 설정
interface CustomAgentConfig {
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    keywords: string[];
    category: string;
    emoji?: string;
    temperature?: number;
    maxTokens?: number;
    createdBy?: string;
    createdAt: Date;
    updatedAt: Date;
    enabled: boolean;
}

// A/B 테스트 결과
interface ABTestResult {
    testId: string;
    agentA: string;
    agentB: string;
    totalQueries: number;
    results: {
        agentAWins: number;
        agentBWins: number;
        ties: number;
    };
    metrics: {
        agentAAvgTime: number;
        agentBAvgTime: number;
        agentAAvgRating: number;
        agentBAvgRating: number;
    };
    winner: 'A' | 'B' | 'tie';
    startedAt: Date;
    completedAt?: Date;
}

/**
 * 커스텀 에이전트 빌더
 */
export class CustomAgentBuilder {
    private customAgents: Map<string, CustomAgentConfig> = new Map();
    private abTests: Map<string, ABTestResult> = new Map();
    private promptsDir: string;

    constructor(promptsDir: string = './src/agents/prompts') {
        this.promptsDir = promptsDir;
        this.loadFromDB().catch((err: unknown) => logger.error('Failed to load custom agents from DB:', err));
        logger.info('커스텀 에이전트 빌더 초기화됨');
    }

    /**
     * DB 풀 가져오기 (require로 순환 참조 방지)
     */
    private getPool() {
        const { getUnifiedDatabase } = require('../data/models/unified-database');
        return getUnifiedDatabase().getPool();
    }

    /**
     * DB에서 커스텀 에이전트 로드
     */
    private async loadFromDB(): Promise<void> {
        try {
            const pool = this.getPool();
            const result = await pool.query(
                'SELECT id, name, description, system_prompt, keywords, category, emoji, temperature, max_tokens, created_by, enabled, created_at, updated_at FROM custom_agents'
            );
            for (const row of result.rows) {
                const agent: CustomAgentConfig = {
                    id: row.id as string,
                    name: row.name as string,
                    description: (row.description as string) || '',
                    systemPrompt: row.system_prompt as string,
                    keywords: (row.keywords as string[]) || [],
                    category: (row.category as string) || 'custom',
                    emoji: (row.emoji as string) || '🤖',
                    temperature: row.temperature as number | undefined,
                    maxTokens: row.max_tokens as number | undefined,
                    createdBy: row.created_by as string | undefined,
                    createdAt: new Date(row.created_at as string),
                    updatedAt: new Date(row.updated_at as string),
                    enabled: row.enabled as boolean
                };
                this.customAgents.set(agent.id, agent);
            }
            logger.info(`커스텀 에이전트 ${this.customAgents.size}개 DB에서 로드됨`);
        } catch (error) {
            logger.warn('커스텀 에이전트 DB 로드 실패:', error);
        }
    }

    /**
     * 새 커스텀 에이전트 생성
     */
    async createAgent(config: {
        name: string;
        description: string;
        systemPrompt: string;
        keywords: string[];
        category: string;
        emoji?: string;
        temperature?: number;
        maxTokens?: number;
        createdBy?: string;
    }): Promise<CustomAgentConfig> {
        // 고유 ID 생성
        const id = `custom-${sanitizeAgentId(config.name)}-${Date.now()}`;

        const agent: CustomAgentConfig = {
            id,
            name: config.name,
            description: config.description,
            systemPrompt: config.systemPrompt,
            keywords: config.keywords,
            category: config.category,
            emoji: config.emoji || '🤖',
            temperature: config.temperature,
            maxTokens: config.maxTokens,
            createdBy: config.createdBy,
            createdAt: new Date(),
            updatedAt: new Date(),
            enabled: true
        };

        // DB에 저장
        const pool = this.getPool();
        await pool.query(
            `INSERT INTO custom_agents (id, name, description, system_prompt, keywords, category, emoji, temperature, max_tokens, created_by, enabled, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                agent.id, agent.name, agent.description, agent.systemPrompt,
                JSON.stringify(agent.keywords), agent.category, agent.emoji,
                agent.temperature ?? null, agent.maxTokens ?? null,
                agent.createdBy ?? null, agent.enabled,
                agent.createdAt, agent.updatedAt
            ]
        );

        this.customAgents.set(id, agent);

        // 프롬프트 파일도 생성
        this.savePromptFile(id, config.systemPrompt);

        logger.info(`커스텀 에이전트 생성됨: ${id}`);

        return agent;
    }

    /**
     * 기존 에이전트 복제
     */
    async cloneAgent(sourceAgentId: string, modifications: Partial<CustomAgentConfig>): Promise<CustomAgentConfig | null> {
        // 시스템 에이전트에서 프롬프트 로드
        let sourcePrompt = '';
        const promptPath = path.join(this.promptsDir, `${sanitizeAgentId(sourceAgentId)}.md`);
        validatePathWithinDir(promptPath, this.promptsDir);

        if (fs.existsSync(promptPath)) {
            sourcePrompt = fs.readFileSync(promptPath, 'utf-8');
        } else {
            logger.warn(`원본 에이전트 프롬프트 없음: ${sourceAgentId}`);
        }

        const newName = modifications.name || `${sourceAgentId}-clone`;

        return this.createAgent({
            name: newName,
            description: modifications.description || `${sourceAgentId}의 복제본`,
            systemPrompt: modifications.systemPrompt || sourcePrompt,
            keywords: modifications.keywords || [],
            category: modifications.category || 'custom',
            emoji: modifications.emoji,
            temperature: modifications.temperature,
            maxTokens: modifications.maxTokens,
            createdBy: modifications.createdBy
        });
    }

    /**
     * 에이전트 수정
     */
    async updateAgent(agentId: string, updates: Partial<CustomAgentConfig>): Promise<CustomAgentConfig | null> {
        const agent = this.customAgents.get(agentId);
        if (!agent) {
            logger.warn(`에이전트 없음: ${agentId}`);
            return null;
        }

        const updated: CustomAgentConfig = {
            ...agent,
            ...updates,
            id: agent.id, // ID는 변경 불가
            createdAt: agent.createdAt,
            updatedAt: new Date()
        };

        // 동적 UPDATE 쿼리 빌드
        const setClauses: string[] = [];
        const values: (string | number | boolean | null)[] = [];
        let paramIndex = 1;

        const fieldMap: Record<string, string> = {
            name: 'name',
            description: 'description',
            systemPrompt: 'system_prompt',
            category: 'category',
            emoji: 'emoji',
            enabled: 'enabled'
        };

        for (const [key, column] of Object.entries(fieldMap)) {
            if (key in updates) {
                setClauses.push(`${column} = $${paramIndex}`);
                values.push(updates[key as keyof CustomAgentConfig] as string | number | boolean | null);
                paramIndex++;
            }
        }

        if (updates.keywords !== undefined) {
            setClauses.push(`keywords = $${paramIndex}`);
            values.push(JSON.stringify(updates.keywords));
            paramIndex++;
        }
        if (updates.temperature !== undefined) {
            setClauses.push(`temperature = $${paramIndex}`);
            values.push(updates.temperature ?? null);
            paramIndex++;
        }
        if (updates.maxTokens !== undefined) {
            setClauses.push(`max_tokens = $${paramIndex}`);
            values.push(updates.maxTokens ?? null);
            paramIndex++;
        }

        // always update updated_at
        setClauses.push(`updated_at = $${paramIndex}`);
        values.push(updated.updatedAt.toISOString());
        paramIndex++;

        values.push(agentId);

        if (setClauses.length > 0) {
            const pool = this.getPool();
            await pool.query(
                `UPDATE custom_agents SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
                values
            );
        }

        this.customAgents.set(agentId, updated);

        // 프롬프트 업데이트 시 파일도 갱신
        if (updates.systemPrompt) {
            this.savePromptFile(agentId, updates.systemPrompt);
        }

        logger.info(`에이전트 업데이트됨: ${agentId}`);

        return updated;
    }

    /**
     * 에이전트 삭제
     */
    async deleteAgent(agentId: string): Promise<boolean> {
        if (!this.customAgents.has(agentId)) {
            return false;
        }

        // DB에서 삭제
        const pool = this.getPool();
        await pool.query('DELETE FROM custom_agents WHERE id = $1', [agentId]);

        this.customAgents.delete(agentId);

        // 프롬프트 파일도 삭제
        const safeDeleteId = sanitizeAgentId(agentId);
        const promptPath = path.join(this.promptsDir, `${safeDeleteId}.md`);
        validatePathWithinDir(promptPath, this.promptsDir);
        if (fs.existsSync(promptPath)) {
            fs.unlinkSync(promptPath);
        }

        logger.info(`에이전트 삭제됨: ${agentId}`);

        return true;
    }

    /**
     * 프롬프트 파일 저장
     */
    private savePromptFile(agentId: string, prompt: string): void {
        try {
            if (!fs.existsSync(this.promptsDir)) {
                fs.mkdirSync(this.promptsDir, { recursive: true });
            }
            const safeId = sanitizeAgentId(agentId);
            const promptPath = path.join(this.promptsDir, `${safeId}.md`);
            validatePathWithinDir(promptPath, this.promptsDir);
            fs.writeFileSync(promptPath, prompt);
        } catch (error) {
            logger.error(`프롬프트 파일 저장 실패: ${agentId}`, error);
        }
    }

    /**
     * A/B 테스트 시작
     */
    startABTest(agentA: string, agentB: string): ABTestResult {
        const testId = `ab-${Date.now()}`;

        const test: ABTestResult = {
            testId,
            agentA,
            agentB,
            totalQueries: 0,
            results: {
                agentAWins: 0,
                agentBWins: 0,
                ties: 0
            },
            metrics: {
                agentAAvgTime: 0,
                agentBAvgTime: 0,
                agentAAvgRating: 0,
                agentBAvgRating: 0
            },
            winner: 'tie',
            startedAt: new Date()
        };

        this.abTests.set(testId, test);
        logger.info(`A/B 테스트 시작: ${testId} (${agentA} vs ${agentB})`);

        return test;
    }

    /**
     * A/B 테스트 결과 기록
     */
    recordABTestResult(
        testId: string,
        winner: 'A' | 'B' | 'tie',
        metrics: { responseTimeA: number; responseTimeB: number; ratingA?: number; ratingB?: number }
    ): void {
        const test = this.abTests.get(testId);
        if (!test) return;

        test.totalQueries++;

        switch (winner) {
            case 'A': test.results.agentAWins++; break;
            case 'B': test.results.agentBWins++; break;
            case 'tie': test.results.ties++; break;
        }

        // 이동 평균 계산
        const n = test.totalQueries;
        test.metrics.agentAAvgTime = ((test.metrics.agentAAvgTime * (n - 1)) + metrics.responseTimeA) / n;
        test.metrics.agentBAvgTime = ((test.metrics.agentBAvgTime * (n - 1)) + metrics.responseTimeB) / n;

        if (metrics.ratingA) {
            test.metrics.agentAAvgRating = ((test.metrics.agentAAvgRating * (n - 1)) + metrics.ratingA) / n;
        }
        if (metrics.ratingB) {
            test.metrics.agentBAvgRating = ((test.metrics.agentBAvgRating * (n - 1)) + metrics.ratingB) / n;
        }

        // 승자 판정
        if (test.results.agentAWins > test.results.agentBWins * 1.2) {
            test.winner = 'A';
        } else if (test.results.agentBWins > test.results.agentAWins * 1.2) {
            test.winner = 'B';
        } else {
            test.winner = 'tie';
        }
    }

    /**
     * A/B 테스트 완료
     */
    completeABTest(testId: string): ABTestResult | null {
        const test = this.abTests.get(testId);
        if (!test) return null;

        test.completedAt = new Date();
        logger.info(`A/B 테스트 완료: ${testId} - 승자: ${test.winner}`);

        return test;
    }

    /**
     * 모든 커스텀 에이전트 조회
     */
    getAllCustomAgents(): CustomAgentConfig[] {
        return Array.from(this.customAgents.values());
    }

    /**
     * 단일 커스텀 에이전트 조회
     */
    getCustomAgent(agentId: string): CustomAgentConfig | undefined {
        return this.customAgents.get(agentId);
    }

    /**
     * 활성화된 커스텀 에이전트를 Agent 형식으로 변환
     */
    getEnabledAgentsAsAgents(): Agent[] {
        return Array.from(this.customAgents.values())
            .filter(a => a.enabled)
            .map(a => ({
                id: a.id,
                name: a.name,
                description: a.description,
                keywords: a.keywords,
                emoji: a.emoji || '🤖',
                category: a.category
            }));
    }

    /**
     * A/B 테스트 결과 조회
     */
    getABTestResult(testId: string): ABTestResult | undefined {
        return this.abTests.get(testId);
    }

    /**
     * 모든 A/B 테스트 조회
     */
    getAllABTests(): ABTestResult[] {
        return Array.from(this.abTests.values());
    }
}

// 싱글톤 인스턴스
let builderInstance: CustomAgentBuilder | null = null;

export function getCustomAgentBuilder(): CustomAgentBuilder {
    if (!builderInstance) {
        builderInstance = new CustomAgentBuilder();
    }
    return builderInstance;
}
