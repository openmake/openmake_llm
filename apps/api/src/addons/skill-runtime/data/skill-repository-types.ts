/**
 * SkillRepository 의 공개 타입·내부 행 타입 (skill-repository.ts 에서 분리).
 *
 * @module data/repositories/skill-repository-types
 */

export interface AgentSkill {
    id: string;
    name: string;
    description: string;
    content: string;
    category: string;
    isPublic: boolean;
    createdBy?: string;
    createdAt: Date;
    updatedAt: Date;
    sourceRepo?: string;
    sourcePath?: string;
    status?: 'draft' | 'active' | 'archived';
    manifestMeta?: Record<string, unknown>;
    /** 확장 번들 설치분이면 그 확장 id (093) — draft 화면의 확장별 묶음에 쓰인다 */
    extensionId?: string;
    /** 확장 이름 (listDrafts 가 JOIN 으로 채움. 확장 유래가 아니면 undefined) */
    extensionName?: string;
}

export type SkillStatus = 'draft' | 'active' | 'archived';

export interface DraftListOptions {
    target?: 'user' | 'system' | 'all';
    userId?: string;
    limit?: number;
    offset?: number;
}

export interface DraftListResult {
    drafts: AgentSkill[];
    total: number;
    limit: number;
    offset: number;
}

export interface CreateSkillInput {
    name: string;
    description?: string;
    content: string;
    category?: string;
    isPublic?: boolean;
    createdBy?: string;
    sourceRepo?: string;
    sourcePath?: string;
}

export interface UpdateSkillInput {
    name?: string;
    description?: string;
    content?: string;
    category?: string;
    isPublic?: boolean;
}

export interface SkillSearchOptions {
    userId?: string;
    search?: string;
    category?: string;
    isPublic?: boolean;
    sortBy?: 'newest' | 'name' | 'category' | 'updated';
    limit?: number;
    offset?: number;
    /** 'draft' | 'active' | 'all'. 기본값 'active' — 일반 라이브러리에는 draft 노출 금지. */
    status?: 'draft' | 'active' | 'all';
    /**
     * 자기 에이전트에 배정된 페르소나 스킬(id = 접두사 + 배정 agent_id) 제외. 그 에이전트 턴에는 이미
     * 자동 주입되므로 load_skill 카탈로그에 실으면 중복이다 (2026-09-11 실측: 101줄 ≈ 2.2K 토큰/턴).
     */
    excludeAgentPersonas?: boolean;
    excludeCategories?: readonly string[]; // 이 범주를 뺀다 — 절차 스킬(JSON 본문)이 지침 스킬 목록에 섞이지 않게
}

export interface SkillSearchResult {
    skills: AgentSkill[];
    total: number;
    limit: number;
    offset: number;
}

export interface CountRow {
    total: string;
}


export interface SkillOwnerRow {
    created_by: string | null;
}

export interface CategoryCountRow {
    category: string;
    count: string;
}

/** 소유권 검증 요청자 컨텍스트 */
export interface ActorContext {
    userId: string;
    userRole: string;
}
