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
 * - CRUD: createSkill(), updateSkill(), deleteSkill(), searchSkills()
 * - Status workflow: updateStatus(), listDrafts()
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
    SkillStatus,
    DraftListOptions,
    DraftListResult,
} from '../data/repositories/skill-repository';

import type {
    AgentSkill,
    CreateSkillInput,
    UpdateSkillInput,
    SkillSearchOptions,
    SkillSearchResult,
    SkillStatus,
    DraftListOptions,
    DraftListResult,
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

    async updateSkill(id: string, input: UpdateSkillInput, actor?: { userId: string; userRole: string }): Promise<AgentSkill | null> {
        const repo = await this.ensureInitialized();
        const updated = await repo.updateSkill(id, input, actor);
        if (updated) logger.info(`스킬 수정됨: ${id}`);
        return updated;
    }

    async deleteSkill(id: string, actor?: { userId: string; userRole: string }): Promise<boolean> {
        const repo = await this.ensureInitialized();
        const deleted = await repo.deleteSkill(id, actor);
        if (deleted) logger.info(`스킬 삭제됨: ${id}`);
        return deleted;
    }

    async getSkillById(id: string): Promise<AgentSkill | null> {
        const repo = await this.ensureInitialized();
        return repo.getSkillById(id);
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
    // Status workflow (draft → active → archived)
    // ------------------------------------------------

    async updateStatus(id: string, status: SkillStatus, actor?: { userId: string; userRole: string }): Promise<AgentSkill | null> {
        const repo = await this.ensureInitialized();
        const updated = await repo.updateStatus(id, status, actor);
        if (updated) logger.info(`스킬 status 변경: ${id} → ${status} (by ${actor?.userId ?? 'system'})`);
        return updated;
    }

    async listDrafts(options: DraftListOptions): Promise<DraftListResult> {
        const repo = await this.ensureInitialized();
        return repo.listDrafts(options);
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

    async getSkillsForAgent(agentId: string, userId?: string, agentCategory?: string): Promise<AgentSkill[]> {
        const repo = await this.ensureInitialized();
        return repo.getSkillsForAgent(agentId, userId, agentCategory);
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
    async buildSkillPrompt(agentId: string, userId?: string, agentCategory?: string): Promise<string> {
        const skills = await this.getSkillsForAgent(agentId, userId, agentCategory);
        return this.formatSkillsAsPrompt(skills);
    }

    /**
     * Custom Agent (#A 2026-05-26) \u2014 \uc0ac\uc6a9\uc790 \uc815\uc758 agent \uc758 allowed_skills \ubc30\uc5f4\ub85c
     * skill prompt \uad6c\uc131. \uc0b0\uc5c5 agent \uc758 buildSkillPrompt \uc640 \ub3d9\uc77c \ud615\uc2dd.
     *
     * @param skillIds - user_agents.allowed_skills \uc758 skill_manifests id \ubc30\uc5f4
     * @param userId - skill_permissions / is_public \uac00\uc2dc\uc131 \uac80\uc99d\uc6a9
     * @returns prepend \ud560 skill prompt \ube14\ub85d (skill 0\uac1c \ub610\ub294 \ubaa8\ub450 \ubbf8\uc811\uadfc \uad8c\ud55c \uc2dc \ube48 \ubb38\uc790\uc5f4)
     */
    async buildSkillPromptForIds(skillIds: string[], userId?: string): Promise<string> {
        if (!Array.isArray(skillIds) || skillIds.length === 0) return '';
        const repo = await this.ensureInitialized();
        const skills: (AgentSkill | null)[] = await Promise.all(
            skillIds.map(async (id): Promise<AgentSkill | null> => {
                try {
                    const s = await repo.getSkillById(id);
                    if (!s) return null;
                    // \uad8c\ud55c \uac80\uc99d \u2014 public \ub610\ub294 \ubcf8\uc778 \uc18c\uc720\ub9cc (manifest \uad8c\ud55c \uccb4\uacc4\ub294 \ubbf8\uc138\ud654 \uac00\ub2a5)
                    const meta = s as AgentSkill & { is_public?: boolean; created_by?: string };
                    const isPublic = meta.is_public !== false;
                    const isOwner = userId !== undefined && meta.created_by === userId;
                    if (!isPublic && !isOwner) return null;
                    return s;
                } catch {
                    return null;
                }
            }),
        );
        const validSkills = skills.filter((s): s is AgentSkill => s !== null);
        return this.formatSkillsAsPrompt(validSkills);
    }

    /**
     * AgentSkill \ubc30\uc5f4\uc744 system prompt \ube14\ub85d\uc73c\ub85c \ud3ec\ub9f7.
     * buildSkillPrompt / buildSkillPromptForIds \uacf5\ud1b5 helper.
     */
    private formatSkillsAsPrompt(skills: AgentSkill[]): string {
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

    /**
     * \ud65c\uc131\ud654\ub41c skill \uc758 tool_bindings \uc870\ud68c.
     *
     * \ud65c\uc131\ud654 \uae30\uc900 = agent_skill_assignments \uc758 agent_id \uac00 \ub2e4\uc74c \uc911 \ud558\ub098:
     *   - \uc778\uc790 agentId (\ud604\uc7ac \ucc44\ud305\uc758 \uc5d0\uc774\uc804\ud2b8)
     *   - '__global__' (\ubaa8\ub4e0 \uc5d0\uc774\uc804\ud2b8 \uacf5\ud1b5)
     *   - 'user:{userId}' (\uc0ac\uc6a9\uc790 \uac1c\uc778 \ud560\ub2f9)
     *
     * manifest \ud14c\uc774\ube14 (021 \ub9c8\uc774\uadf8\ub808\uc774\uc158) \ubd80\uc7ac \uc2dc \ube48 \ubc30\uc5f4 \ubc18\ud658 (graceful) \u2014
     * \ubcf8 \uba54\uc11c\ub4dc \ub3c4\uc785\uc740 \ubb34\uc601\ud5a5. ChatService.mergeToolsWithSkills() \uac00 \ube48 \ubc30\uc5f4\uc774\uba74
     * \uae30\uc874 \ub3d9\uc791 \uadf8\ub300\ub85c.
     *
     * @see docs/superpowers/plans/2026-05-20-phase5-skill-upload.md \u00a77
     */
    /**
     * Manifest 모델 (021 마이그레이션) 의 prompt_md 를 시스템 프롬프트 블록으로 구성.
     *
     * 활성화 기준 = `getActiveSkillBindings` 와 동일 (agent + global + user:{userId}).
     * 같은 skill 의 최신 version 만 사용.
     *
     * manifest 테이블 부재 시 null 반환 (graceful) — system-prompt 가 legacy
     * `buildSkillPrompt` 로 fallback.
     *
     * @see docs/superpowers/plans/2026-05-20-phase5-skill-upload.md §7.5
     */
    async buildManifestPrompt(agentId: string, userId?: string, agentCategory?: string): Promise<string | null> {
        let pool: Pool;
        try {
            await this.ensureInitialized();
            const { getUnifiedDatabase } = await import('../data/models/unified-database');
            pool = getUnifiedDatabase().getPool();
        } catch (e) {
            logger.debug('manifest prompt — DB 미초기화', e);
            return null;
        }

        const params: unknown[] = [agentId, '__global__'];
        let userClause = '';
        if (userId) {
            userClause = ' OR asa.agent_id = $3';
            params.push(`user:${userId}`);
        }

        const sql = `
            SELECT sm.id, sm.prompt_md, sm.manifest_yaml
            FROM skill_manifests sm
            INNER JOIN agent_skill_assignments asa ON asa.skill_id = sm.id
            WHERE (asa.agent_id = $1 OR asa.agent_id = $2${userClause})
              AND sm.version = (
                  SELECT MAX(version) FROM skill_manifests WHERE id = sm.id
              )
            ORDER BY asa.priority DESC NULLS LAST, sm.id ASC
            LIMIT 15
        `;
        let rows: Array<{ id: string; prompt_md: string; manifest_yaml: string }>;
        try {
            const result = await pool.query<{ id: string; prompt_md: string; manifest_yaml: string }>(sql, params);
            rows = result.rows;
        } catch (e) {
            logger.debug('skill_manifests 조회 실패 (021 마이그레이션 미적용?) — null', e);
            return null;
        }
        if (rows.length === 0) return null;

        // agentCategory 필터: manifest_yaml 의 category 가 agent.category 와 일치하거나
        // user-* prefix (사용자 개인 manifest) 인 경우만 포함 — 무관한 skill 의 프롬프트 오염 방지.
        const filtered = rows.filter(r => {
            if (!agentCategory) return true;
            if (r.id.startsWith('user-')) return true;
            const cat = /^---[\s\S]*?\bcategory:\s*([^\n]+)/.exec(r.manifest_yaml);
            return !cat || cat[1]?.trim().replace(/^['"]|['"]$/g, '') === agentCategory;
        });
        if (filtered.length === 0) return null;

        const blocks = filtered.map(r => {
            const safeId = r.id.replace(/[<>"&]/g, '');
            return `<skill_context name="${safeId}">\n${r.prompt_md}\n</skill_context>`;
        });
        return `\n\n## 적용된 스킬 (manifest)\n${blocks.join('\n\n')}`;
    }

    async getActiveSkillBindings(agentId: string, userId?: string): Promise<ActiveSkillBinding[]> {
        let pool: Pool;
        try {
            await this.ensureInitialized();
            const { getUnifiedDatabase } = await import('../data/models/unified-database');
            pool = getUnifiedDatabase().getPool();
        } catch (e) {
            logger.debug('skill binding \uc870\ud68c \u2014 DB \ubbf8\ucd08\uae30\ud654', e);
            return [];
        }

        const params: unknown[] = [agentId, '__global__'];
        let userClause = '';
        if (userId) {
            userClause = ' OR asa.agent_id = $3';
            params.push(`user:${userId}`);
        }

        const sql = `
            SELECT stb.skill_id, stb.skill_version, stb.tool_name, stb.binding_mode
            FROM skill_tool_bindings stb
            INNER JOIN agent_skill_assignments asa ON asa.skill_id = stb.skill_id
            WHERE (asa.agent_id = $1 OR asa.agent_id = $2${userClause})
            ORDER BY stb.skill_id, stb.tool_name
        `;
        try {
            const result = await pool.query<ActiveSkillBinding>(sql, params);
            return result.rows;
        } catch (e) {
            logger.debug('skill_tool_bindings \uc870\ud68c \uc2e4\ud328 (\ub9c8\uc774\uadf8\ub808\uc774\uc158 021 \ubbf8\uc801\uc6a9?) \u2014 \ube48 \ubc30\uc5f4 \ubc18\ud658', e);
            return [];
        }
    }
}

/**
 * \ud65c\uc131\ud654\ub41c skill \uc758 \ub2e8\uc77c \ub3c4\uad6c binding row.
 * @see services/chat-service/tool-merger.ts \uc758 \ub3d9\uc77c \ud0c0\uc785
 */
export interface ActiveSkillBinding {
    skill_id: string;
    skill_version: string;
    tool_name: string;
    binding_mode: 'required' | 'allowed' | 'denied';
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
