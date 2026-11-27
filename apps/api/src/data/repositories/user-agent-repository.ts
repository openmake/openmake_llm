/**
 * @module data/repositories/user-agent-repository
 * @description Custom Agent (사용자 정의 페르소나) CRUD.
 *
 * 도입 (2026-05-26): claude.ai Projects / ChatGPT Custom GPTs 동등 기능.
 * 사용자가 자신만의 system prompt + tools + skills 묶음을 정의하고 재사용.
 *
 * @see db/migrations/033_user_agents.sql
 */
import { BaseRepository, type QueryParam } from './base-repository';

export type UserAgentVisibility = 'private' | 'shared' | 'organization';
/** 'approved'(기본 — 직접 생성·기존 행) | 'pending'(확장 설치분, 승인 전엔 실행·목록·공유 제외 — 206) */
export type UserAgentApprovalStatus = 'approved' | 'pending';

/** 가시성 SQL 조각 — 소유자 OR 인스턴스 공유 OR (활성 조직 공유). $u = userId, $o = orgId(없으면 조직 절 생략). */
function visibleWhere(u: string, o: string | null): string {
    return o
        ? `(user_id = ${u} OR visibility = 'shared' OR (visibility = 'organization' AND org_id = ${o}))`
        : `(user_id = ${u} OR visibility = 'shared')`;
}

interface UserAgent {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    system_prompt: string;
    allowed_tools: string[];
    allowed_skills: string[];
    icon: string | null;
    /** 에이전트 전용 모델 fullId (NULL=상속 — 요청 model 자동일 때만 적용, Phase C) */
    model: string | null;
    /** 'private'(기본, 소유자 전용) | 'shared'(워크스페이스 전원 사용) | 'organization'(org_id 조직 멤버 사용, 128). 편집/삭제는 소유자 한정. */
    visibility: UserAgentVisibility;
    /** visibility='organization' 일 때 대상 조직 (128). */
    org_id?: string | null;
    is_active: boolean;
    usage_count: number;
    /** 확장 번들 설치분이면 그 확장 id (103) */
    extension_id?: string | null;
    /** 승인 상태 (206) — pending 은 소유자의 승인함에만 보인다 */
    approval_status?: UserAgentApprovalStatus;
    created_at: string;
    updated_at: string;
}

/** 승인 대기 목록의 출처 — 확장 이름·원본 URL·커밋(확장 레코드가 없으면 NULL) */
export interface UserAgentPendingOrigin {
    extension_name: string | null;
    extension_source_url: string | null;
    extension_source_ref: string | null;
}

/** 목록 응답용 — 소유 여부 플래그 부착(다른 사용자의 공유 에이전트 구분). */
interface UserAgentWithOwnership extends UserAgent {
    owned: boolean;
}

interface UserAgentCreate {
    id: string;
    userId: string;
    name: string;
    description?: string | null;
    systemPrompt: string;
    allowedTools?: string[];
    allowedSkills?: string[];
    icon?: string | null;
    model?: string | null;
    /** 확장 번들에서 설치된 경우 그 확장 id (제거/업데이트 시 함께 정리) */
    extensionId?: string | null;
    /** 기본 'approved'. 확장 설치분은 'pending' — 승인 전엔 실행·목록·공유에서 빠진다 */
    approvalStatus?: UserAgentApprovalStatus;
}

interface UserAgentUpdate {
    name?: string;
    description?: string | null;
    systemPrompt?: string;
    allowedTools?: string[];
    allowedSkills?: string[];
    icon?: string | null;
    model?: string | null;
}

export class UserAgentRepository extends BaseRepository {
    async create(params: UserAgentCreate): Promise<UserAgent> {
        const result = await this.query<UserAgent>(
            `INSERT INTO user_agents (
                id, user_id, name, description, system_prompt,
                allowed_tools, allowed_skills, icon, model, extension_id, approval_status
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)
             RETURNING *`,
            [
                params.id,
                params.userId,
                params.name,
                params.description ?? null,
                params.systemPrompt,
                JSON.stringify(params.allowedTools ?? []),
                JSON.stringify(params.allowedSkills ?? []),
                params.icon ?? null,
                params.model ?? null,
                params.extensionId ?? null,
                params.approvalStatus ?? 'approved',
            ],
        );
        return result.rows[0] as UserAgent;
    }

    /**
     * 이름 중복 확인 — UNIQUE(user_id, name) 위반을 사전 회피하기 위한 조회.
     * soft-delete(is_active=FALSE) 된 행도 제약 대상이라 포함해서 본다.
     */
    async existsByName(userId: string, name: string): Promise<boolean> {
        const r = await this.query<{ one: number }>(
            'SELECT 1 AS one FROM user_agents WHERE user_id = $1 AND name = $2 LIMIT 1',
            [userId, name],
        );
        return r.rows.length > 0;
    }

    async listByUser(userId: string, includeInactive = false): Promise<UserAgent[]> {
        const where = includeInactive ? '' : 'AND is_active = TRUE';
        const result = await this.query<UserAgent>(
            `SELECT * FROM user_agents WHERE user_id = $1 ${where}
             ORDER BY updated_at DESC`,
            [userId],
        );
        return result.rows as UserAgent[];
    }

    async getByIdForUser(id: string, userId: string): Promise<UserAgent | undefined> {
        // soft-delete 계약: is_active=FALSE 는 삭제된 에이전트 — 조회에서 제외 (listByUser 와 동일)
        const result = await this.query<UserAgent>(
            'SELECT * FROM user_agents WHERE id = $1 AND user_id = $2 AND is_active = TRUE',
            [id, userId],
        );
        return result.rows[0] as UserAgent | undefined;
    }

    /**
     * 실행/사용 경로용 조회 — 소유 에이전트 OR 워크스페이스 공유 에이전트(다른 소유자).
     * loadUserAgent 의 유일 choke point 가 이걸 호출해 크로스유저 공유 사용을 연다.
     * 편집/삭제는 여전히 getByIdForUser·update·softDelete 의 user_id 한정을 통과해야 한다.
     */
    async getByIdVisibleToUser(id: string, userId: string, orgId: string | null = null): Promise<UserAgent | undefined> {
        const result = await this.query<UserAgent>(
            `SELECT * FROM user_agents
             WHERE id = $1 AND is_active = TRUE AND approval_status = 'approved'
               AND ${visibleWhere('$2', orgId ? '$3' : null)}`,
            orgId ? [id, userId, orgId] : [id, userId],
        );
        return result.rows[0] as UserAgent | undefined;
    }

    /** 목록 — 본인 소유(전부) + 다른 소유자의 공유 에이전트. owned 플래그로 구분. */
    async listVisibleToUser(userId: string, orgId: string | null = null): Promise<UserAgentWithOwnership[]> {
        const result = await this.query<UserAgentWithOwnership>(
            `SELECT *, (user_id = $1) AS owned FROM user_agents
             WHERE is_active = TRUE AND approval_status = 'approved' AND ${visibleWhere('$1', orgId ? '$2' : null)}
             ORDER BY owned DESC, updated_at DESC`,
            orgId ? [userId, orgId] : [userId],
        );
        return result.rows as UserAgentWithOwnership[];
    }

    /**
     * 공유 상태 전환 — 소유자 전용(user_id 한정). private/shared/organization.
     * organization 이면 orgId 필수(호출부가 활성 조직 멤버십을 검증한 값), 그 외엔 org_id 를 비운다.
     */
    async setVisibility(id: string, userId: string, visibility: UserAgentVisibility, orgId: string | null = null): Promise<UserAgent | undefined> {
        const result = await this.query<UserAgent>(
            `UPDATE user_agents SET visibility = $3, org_id = $4, updated_at = NOW()
             WHERE id = $1 AND user_id = $2 AND is_active = TRUE AND approval_status = 'approved'
             RETURNING *`,
            [id, userId, visibility, visibility === 'organization' ? orgId : null],
        );
        return result.rows[0] as UserAgent | undefined;
    }

    async update(id: string, userId: string, patch: UserAgentUpdate): Promise<UserAgent | undefined> {
        const sets: string[] = [];
        const values: QueryParam[] = [];
        let i = 1;
        if (patch.name !== undefined)         { sets.push(`name = $${i++}`); values.push(patch.name); }
        if (patch.description !== undefined)  { sets.push(`description = $${i++}`); values.push(patch.description); }
        if (patch.systemPrompt !== undefined) { sets.push(`system_prompt = $${i++}`); values.push(patch.systemPrompt); }
        if (patch.allowedTools !== undefined) { sets.push(`allowed_tools = $${i++}::jsonb`); values.push(JSON.stringify(patch.allowedTools)); }
        if (patch.allowedSkills !== undefined){ sets.push(`allowed_skills = $${i++}::jsonb`); values.push(JSON.stringify(patch.allowedSkills)); }
        if (patch.icon !== undefined)         { sets.push(`icon = $${i++}`); values.push(patch.icon); }
        if (patch.model !== undefined)        { sets.push(`model = $${i++}`); values.push(patch.model); }
        if (sets.length === 0) return this.getByIdForUser(id, userId);
        sets.push(`updated_at = NOW()`);
        values.push(id, userId);
        const result = await this.query<UserAgent>(
            `UPDATE user_agents SET ${sets.join(', ')}
             WHERE id = $${i++} AND user_id = $${i++} AND is_active = TRUE
             RETURNING *`,
            values,
        );
        return result.rows[0] as UserAgent | undefined;
    }

    /**
     * 승인 대기(확장 설치분) — 소유자 본인 것만. 승인함이 시스템 프롬프트를 보여 주고 검토하게 한다.
     * `withOrigin`(승인 대기 설치 opt-in 일 때 호출부가 켠다)이면 어느 확장·원본·커밋에서 왔는지를 함께 싣는다 —
     * 승인자가 출처를 보고 판단하게(꺼져 있으면 종전 SQL·모양 그대로).
     */
    async listPendingForUser(userId: string, opts?: { withOrigin?: boolean }): Promise<Array<UserAgent & Partial<UserAgentPendingOrigin>>> {
        const result = opts?.withOrigin
            ? await this.query<UserAgent & UserAgentPendingOrigin>(
                `SELECT ua.*, e.name AS extension_name, e.source_url AS extension_source_url, e.source_ref AS extension_source_ref
                   FROM user_agents ua
                   LEFT JOIN user_extensions e ON e.id = ua.extension_id
                  WHERE ua.user_id = $1 AND ua.is_active = TRUE AND ua.approval_status = 'pending'
                  ORDER BY ua.created_at DESC`,
                [userId],
            )
            : await this.query<UserAgent>(
                `SELECT * FROM user_agents
             WHERE user_id = $1 AND is_active = TRUE AND approval_status = 'pending'
             ORDER BY created_at DESC`,
                [userId],
            );
        return result.rows as Array<UserAgent & Partial<UserAgentPendingOrigin>>;
    }

    async countPendingForUser(userId: string): Promise<number> {
        const r = await this.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM user_agents
             WHERE user_id = $1 AND is_active = TRUE AND approval_status = 'pending'`,
            [userId],
        );
        return Number(r.rows[0]?.count ?? 0);
    }

    /** pending → approved (소유자 한정). 대상이 없거나 이미 승인됐으면 undefined. */
    async approve(id: string, userId: string): Promise<UserAgent | undefined> {
        const result = await this.query<UserAgent>(
            `UPDATE user_agents SET approval_status = 'approved', updated_at = NOW()
             WHERE id = $1 AND user_id = $2 AND is_active = TRUE AND approval_status = 'pending'
             RETURNING *`,
            [id, userId],
        );
        return result.rows[0] as UserAgent | undefined;
    }

    /**
     * pending 거절 — soft-delete(is_active=FALSE). 이름도 비켜 준다: UNIQUE(user_id, name) 은 soft-delete 행에도 걸려,
     * 남겨 두면 같은 확장을 다시 설치할 때 에이전트가 랜덤 suffix 를 단다(archiveLinkedComponents 와 같은 규칙).
     */
    async reject(id: string, userId: string): Promise<boolean> {
        const result = await this.query<{ id: string }>(
            `UPDATE user_agents
                SET is_active = FALSE, updated_at = NOW(),
                    name = name || '-rejected-' || substr(md5(random()::text), 1, 6)
              WHERE id = $1 AND user_id = $2 AND is_active = TRUE AND approval_status = 'pending'
              RETURNING id`,
            [id, userId],
        );
        return result.rowCount! > 0;
    }

    async softDelete(id: string, userId: string): Promise<boolean> {
        const result = await this.query<{ id: string }>(
            'UPDATE user_agents SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, userId],
        );
        return result.rowCount! > 0;
    }

    async incrementUsage(id: string): Promise<void> {
        await this.query(
            'UPDATE user_agents SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = $1',
            [id],
        );
    }
}
