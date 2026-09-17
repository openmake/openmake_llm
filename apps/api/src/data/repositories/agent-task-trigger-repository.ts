/**
 * @module data/repositories/agent-task-trigger-repository
 * @description `agent_task_triggers`(132) — 인바운드 웹훅 트리거. 시크릿은 암호문만 다루고(token-crypto 는 호출부),
 * 목록·단건 조회는 암호문을 빼고 돌려준다(수신 검증만 `getForVerification`).
 */
import { BaseRepository } from './base-repository';

export interface AgentTaskTrigger {
    id: string;
    user_id: string;
    template_id: string;
    name: string;
    enabled: boolean;
    approval_policy: string;
    last_delivery_id: string | null;
    last_fired_at: string | null;
    last_task_id: string | null;
    fire_count: number;
    consecutive_failures: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
}

const PUBLIC_COLUMNS = `id, user_id, template_id, name, enabled, approval_policy, last_delivery_id, last_fired_at, last_task_id,
    fire_count, consecutive_failures, last_error, created_at, updated_at`;

export class AgentTaskTriggerRepository extends BaseRepository {
    async create(p: { id: string; userId: string; templateId: string; name: string; secretEncrypted: string; approvalPolicy: string }): Promise<void> {
        await this.query(
            `INSERT INTO agent_task_triggers (id, user_id, template_id, name, secret_encrypted, approval_policy) VALUES ($1, $2, $3, $4, $5, $6)`,
            [p.id, p.userId, p.templateId, p.name, p.secretEncrypted, p.approvalPolicy],
        );
    }

    async get(id: string): Promise<AgentTaskTrigger | undefined> {
        const r = await this.query<AgentTaskTrigger>(`SELECT ${PUBLIC_COLUMNS} FROM agent_task_triggers WHERE id = $1`, [id]);
        return r.rows[0];
    }

    /** 수신 검증 전용 — 암호문 포함. */
    async getForVerification(id: string): Promise<(AgentTaskTrigger & { secret_encrypted: string }) | undefined> {
        const r = await this.query<AgentTaskTrigger & { secret_encrypted: string }>(`SELECT ${PUBLIC_COLUMNS}, secret_encrypted FROM agent_task_triggers WHERE id = $1`, [id]);
        return r.rows[0];
    }

    async listByUser(userId: string): Promise<AgentTaskTrigger[]> {
        const r = await this.query<AgentTaskTrigger>(`SELECT ${PUBLIC_COLUMNS} FROM agent_task_triggers WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
        return r.rows;
    }

    async countByUser(userId: string): Promise<number> {
        const r = await this.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM agent_task_triggers WHERE user_id = $1', [userId]);
        return parseInt(r.rows[0]?.n ?? '0', 10);
    }

    /** 이름·활성·승인 정책 부분 수정 — 다시 켜면 연속 실패 수를 지운다. */
    async update(id: string, p: { name?: string; enabled?: boolean; approvalPolicy?: string }): Promise<void> {
        await this.query(
            `UPDATE agent_task_triggers SET name = COALESCE($2, name), enabled = COALESCE($3, enabled),
                    approval_policy = COALESCE($4, approval_policy),
                    consecutive_failures = CASE WHEN $3 IS TRUE THEN 0 ELSE consecutive_failures END, updated_at = NOW()
              WHERE id = $1`,
            [id, p.name ?? null, p.enabled ?? null, p.approvalPolicy ?? null],
        );
    }

    async rotateSecret(id: string, secretEncrypted: string): Promise<void> {
        await this.query('UPDATE agent_task_triggers SET secret_encrypted = $2, updated_at = NOW() WHERE id = $1', [id, secretEncrypted]);
    }

    async delete(id: string): Promise<void> {
        await this.query('DELETE FROM agent_task_triggers WHERE id = $1', [id]);
    }

    /**
     * 전달 id 선점 — 같은 X-Openmake-Delivery 재전송이면 false(no-op). id 가 없으면 항상 true.
     * 조건부 UPDATE 한 문장이라 동시 재전송도 한 번만 통과한다.
     */
    async claimDelivery(id: string, deliveryId: string | undefined): Promise<boolean> {
        if (!deliveryId) return true;
        const r = await this.query(
            `UPDATE agent_task_triggers SET last_delivery_id = $2 WHERE id = $1 AND last_delivery_id IS DISTINCT FROM $2 RETURNING id`,
            [id, deliveryId],
        );
        return (r.rowCount ?? 0) > 0;
    }

    async recordFired(id: string, taskId: string): Promise<void> {
        await this.query(
            `UPDATE agent_task_triggers SET last_fired_at = NOW(), last_task_id = $2, fire_count = fire_count + 1,
                    consecutive_failures = 0, last_error = NULL, updated_at = NOW() WHERE id = $1`,
            [id, taskId],
        );
    }

    /** 발화 실패(템플릿 없음·작업 생성 실패) — 연속 실패가 상한이면 비활성. 서명 실패는 세지 않는다(남이 끌 수 없게). */
    async recordFailure(id: string, error: string, disableAfter: number): Promise<{ disabled: boolean }> {
        const r = await this.query<{ enabled: boolean }>(
            // last_delivery_id 도 비운다 — 선점한 전달이 실패했으면 보내는 쪽의 같은 id 재시도가 처리되어야 한다
            `UPDATE agent_task_triggers SET consecutive_failures = consecutive_failures + 1, last_error = $2, last_delivery_id = NULL,
                    enabled = CASE WHEN consecutive_failures + 1 >= $3 THEN FALSE ELSE enabled END, updated_at = NOW()
              WHERE id = $1 RETURNING enabled`,
            [id, error.slice(0, 500), disableAfter],
        );
        return { disabled: r.rows[0]?.enabled === false };
    }
}
