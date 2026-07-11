/**
 * @module data/repositories/agent-task-template-repository
 * @description `agent_task_templates` 테이블 데이터 접근 (Phase 6-1 작업 템플릿).
 *
 * goal 템플릿({{param}} 치환) CRUD. schedule-repository 처럼 unified-database facade 없이
 * 직접 사용(getPool() 주입 — facade 팽창 회피).
 */
import { BaseRepository } from './base-repository';

export interface TemplateParamDef {
    name: string;
    description?: string;
    default?: string;
}

export interface AgentTaskTemplate {
    id: string;
    user_id?: string;
    name: string;
    goal_template: string;
    params?: TemplateParamDef[] | null;
    max_turns: number;
    created_at: string;
    updated_at: string;
}

export class AgentTaskTemplateRepository extends BaseRepository {
    async create(p: {
        id: string; userId: string; name: string; goalTemplate: string;
        params?: TemplateParamDef[]; maxTurns: number;
    }): Promise<void> {
        await this.query(
            `INSERT INTO agent_task_templates (id, user_id, name, goal_template, params, max_turns)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [p.id, p.userId, p.name, p.goalTemplate, p.params ? JSON.stringify(p.params) : null, p.maxTurns],
        );
    }

    async get(id: string): Promise<AgentTaskTemplate | undefined> {
        const r = await this.query<AgentTaskTemplate>('SELECT * FROM agent_task_templates WHERE id = $1', [id]);
        return r.rows[0];
    }

    async listByUser(userId: string): Promise<AgentTaskTemplate[]> {
        const r = await this.query<AgentTaskTemplate>(
            'SELECT * FROM agent_task_templates WHERE user_id = $1 ORDER BY updated_at DESC', [userId]);
        return r.rows;
    }

    async update(id: string, u: {
        name?: string; goalTemplate?: string; params?: TemplateParamDef[] | null; maxTurns?: number;
    }): Promise<void> {
        const sets: string[] = ['updated_at = NOW()'];
        const vals: unknown[] = [];
        let i = 1;
        if (u.name !== undefined) { sets.push(`name = $${i++}`); vals.push(u.name); }
        if (u.goalTemplate !== undefined) { sets.push(`goal_template = $${i++}`); vals.push(u.goalTemplate); }
        if (u.params !== undefined) { sets.push(`params = $${i++}`); vals.push(u.params ? JSON.stringify(u.params) : null); }
        if (u.maxTurns !== undefined) { sets.push(`max_turns = $${i++}`); vals.push(u.maxTurns); }
        vals.push(id);
        await this.query(`UPDATE agent_task_templates SET ${sets.join(', ')} WHERE id = $${i}`, vals as never[]);
    }

    async delete(id: string): Promise<void> {
        await this.query('DELETE FROM agent_task_templates WHERE id = $1', [id]);
    }
}

/**
 * PURE: goal 템플릿의 {{name}} 자리를 값으로 치환. 정의 파라미터만 치환하고
 * 값 미제공 시 default → 그것도 없으면 빈 문자열. 미정의 {{...}} 는 그대로 둔다(오탈자 가시화).
 */
export function instantiateGoal(
    goalTemplate: string,
    paramDefs: TemplateParamDef[] | null | undefined,
    values: Record<string, string>,
): string {
    let out = goalTemplate;
    for (const def of paramDefs ?? []) {
        const v = values[def.name] ?? def.default ?? '';
        out = out.split(`{{${def.name}}}`).join(v);
    }
    return out;
}
