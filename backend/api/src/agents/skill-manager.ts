/**
 * ============================================================
 * Agent Skill Manager - 에이전트 스킬 CRUD 및 주입 관리
 * ============================================================
 *
 * 에이전트 스킬(재사용 가능한 전문 지식/지시 블록)의 생성, 수정, 삭제,
 * 에이전트 연결 및 채팅 파이프라인 주입을 담당합니다.
 *
 * SkillRepository를 통해 DB 접근을 위임하며,
 * 직접 Pool 접근이나 require()를 사용하지 않습니다.
 *
 * @module agents/skill-manager
 * @description
 * - CRUD: createSkill(), updateSkill(), deleteSkill(), getAllSkills()
 * - 연결: assignSkillToAgent(), removeSkillFromAgent(), getSkillsForAgent()
 * - 주입: buildSkillPrompt() - 에이전트 시스템 프롬프트에 스킬 내용 삽입
 * - 소유권: getSkillOwner() - 스킬 소유자 확인
 * - 싱글톤: getSkillManager()
 */

import { createLogger } from '../utils/logger';
import { SkillRepository } from '../data/repositories/skill-repository';
import type { Pool } from 'pg';

// Re-export 인터페이스 (기존 사용처 호환)
export type {
    AgentSkill,
    AgentSkillAssignment,
    CreateSkillInput,
    UpdateSkillInput,
    SkillSearchOptions,
    SkillSearchResult,
} from '../data/repositories/skill-repository';

import type {
    AgentSkill,
    CreateSkillInput,
    UpdateSkillInput,
    SkillSearchOptions,
    SkillSearchResult,
} from '../data/repositories/skill-repository';

const logger = createLogger('SkillManager');

/** 스킬 내용 최대 길이 (프롬프트 인젝션 완화용) */
const MAX_SKILL_CONTENT_LENGTH = 10_000;

// ========================================
// SkillManager 클래스
// ========================================

export class SkillManager {
    private repo: SkillRepository | null = null;
    private initPromise: Promise<void> | null = null;

    /**
     * SkillRepository 초기화 (Promise 기반 싱글톤 락)
     * 동시 요청이 들어와도 한 번만 초기화됩니다.
     */
    private async ensureInitialized(): Promise<SkillRepository> {
        if (this.repo) return this.repo;

        if (!this.initPromise) {
            this.initPromise = this.doInit();
        }
        await this.initPromise;
        if (!this.repo) throw new Error('SkillRepository initialization failed');
        return this.repo;
    }

    private async doInit(): Promise<void> {
        // 지연 로딩: 순환 참조 방지를 위해 동적 import 사용
        const { getUnifiedDatabase } = await import('../data/models/unified-database');
        const pool: Pool = getUnifiedDatabase().getPool();
        this.repo = new SkillRepository(pool);
        logger.info('📋 SkillManager 초기화 완료 (SkillRepository 연결)');
    }

    /**
     * SkillRepository에 직접 접근 (라우트에서 카테고리 조회 등에 사용)
     */
    async getRepository(): Promise<SkillRepository> {
        return this.ensureInitialized();
    }

    // ------------------------------------------------
    // 스킬 CRUD
    // ------------------------------------------------

    async createSkill(input: CreateSkillInput): Promise<AgentSkill> {
        const repo = await this.ensureInitialized();
        const skill = await repo.createSkill(input);
        logger.info(`스킬 생성됨: ${skill.id} (${skill.name})`);
        return skill;
    }

    async updateSkill(id: string, input: UpdateSkillInput): Promise<AgentSkill | null> {
        const repo = await this.ensureInitialized();
        const updated = await repo.updateSkill(id, input);
        if (updated) logger.info(`스킬 수정됨: ${id}`);
        return updated;
    }

    async deleteSkill(id: string): Promise<boolean> {
        const repo = await this.ensureInitialized();
        const deleted = await repo.deleteSkill(id);
        if (deleted) logger.info(`스킬 삭제됨: ${id}`);
        return deleted;
    }

    async getSkillById(id: string): Promise<AgentSkill | null> {
        const repo = await this.ensureInitialized();
        return repo.getSkillById(id);
    }

    async getAllSkills(userId?: string): Promise<AgentSkill[]> {
        const repo = await this.ensureInitialized();
        return repo.getAllSkills(userId);
    }

    async searchSkills(options: SkillSearchOptions): Promise<SkillSearchResult> {
        const repo = await this.ensureInitialized();
        return repo.searchSkills(options);
    }

    // ------------------------------------------------
    // 소유권 조회
    // ------------------------------------------------

    async getSkillOwner(skillId: string): Promise<string | null> {
        const repo = await this.ensureInitialized();
        return repo.getSkillOwner(skillId);
    }

    // ------------------------------------------------
    // 에이전트-스킬 연결
    // ------------------------------------------------

    async assignSkillToAgent(agentId: string, skillId: string, priority: number = 0): Promise<void> {
        const repo = await this.ensureInitialized();
        await repo.assignSkillToAgent(agentId, skillId, priority);
        logger.info(`스킬 연결됨: 에이전트=${agentId}, 스킬=${skillId}`);
    }

    async removeSkillFromAgent(agentId: string, skillId: string): Promise<void> {
        const repo = await this.ensureInitialized();
        await repo.removeSkillFromAgent(agentId, skillId);
        logger.info(`스킬 연결 해제: 에이전트=${agentId}, 스킬=${skillId}`);
    }

    async getSkillsForAgent(agentId: string, userId?: string): Promise<AgentSkill[]> {
        const repo = await this.ensureInitialized();
        return repo.getSkillsForAgent(agentId, userId);
    }

    async getSkillIdsForAgent(agentId: string, userId?: string): Promise<string[]> {
        const repo = await this.ensureInitialized();
        return repo.getSkillIdsForAgent(agentId, userId);
    }

    // ------------------------------------------------
    // 사용자 개인 스킬
    // ------------------------------------------------

    async assignSkillToUser(userId: string, skillId: string, priority: number = 0): Promise<void> {
        const repo = await this.ensureInitialized();
        await repo.assignSkillToUser(userId, skillId, priority);
        logger.info(`개인 스킬 할당: 사용자=${userId}, 스킬=${skillId}`);
    }

    async removeSkillFromUser(userId: string, skillId: string): Promise<void> {
        const repo = await this.ensureInitialized();
        await repo.removeSkillFromUser(userId, skillId);
        logger.info(`개인 스킬 할당 해제: 사용자=${userId}, 스킬=${skillId}`);
    }

    async getUserSkills(userId: string): Promise<AgentSkill[]> {
        const repo = await this.ensureInitialized();
        return repo.getUserSkills(userId);
    }

    async getUserSkillIds(userId: string): Promise<string[]> {
        const repo = await this.ensureInitialized();
        return repo.getUserSkillIds(userId);
    }

    // ------------------------------------------------
    // 프롬프트 주입
    // ------------------------------------------------

    /**
     * 에이전트 스킬 프롬프트 블록 생성
     * 시스템 프롬프트에 추가할 스킬 내용 문자열을 반환합니다.
     * `<skill_context>` 경계 태그로 격리하여 프롬프트 인젝션을 완화합니다.
     * userId가 주어지면 개인 할당 스킬도 포함합니다.
     */
    async buildSkillPrompt(agentId: string, userId?: string): Promise<string> {
        const skills = await this.getSkillsForAgent(agentId, userId);
        if (skills.length === 0) return '';
        const skillBlocks = skills
            .map(s => {
                const content = s.content.length > MAX_SKILL_CONTENT_LENGTH
                    ? s.content.slice(0, MAX_SKILL_CONTENT_LENGTH) + '\n... (truncated)'
                    : s.content;
                const safeName = s.name.replace(/[<>"&]/g, '');
                return `<skill_context name="${safeName}">\n${content}\n</skill_context>`;
            })
            .join('\n\n');
        return `\n\n## \uc801\uc6a9\ub41c \uc2a4\ud0ac\n${skillBlocks}`;
    }
}

// ========================================
// 싱글톤
// ========================================

let skillManagerInstance: SkillManager | null = null;

export function getSkillManager(): SkillManager {
    if (!skillManagerInstance) {
        skillManagerInstance = new SkillManager();
    }
    return skillManagerInstance;
}
