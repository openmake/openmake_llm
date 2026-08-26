/**
 * @module data/repositories/agent-task-share-repository
 * @description `agent_task_shares` — 에이전트 작업 읽기 전용 공유(107).
 *
 * 공유는 작업당 하나이고 재게시는 upsert 다. `snapshot` 은 게시 시점 공유 문서를 그대로
 * 담는다(라이브 조인 금지 — plan §4).
 */
import { BaseRepository } from './base-repository';

export type ShareVisibility = 'private' | 'authenticated' | 'link';

export interface AgentTaskShareRow {
    share_id: string;
    task_id: string;
    owner_user_id: string;
    visibility: ShareVisibility;
    share_token: string | null;
    snapshot: unknown;
    include_diff: boolean;
    include_steps: boolean;
    created_at: Date;
    updated_at: Date;
}

export class AgentTaskShareRepository extends BaseRepository {
    /** 게시(또는 재게시) — 작업당 1건 upsert. 스냅샷·토글·visibility 를 갱신한다. */
    async upsert(params: {
        shareId: string;
        taskId: string;
        ownerUserId: string;
        visibility: ShareVisibility;
        shareToken: string | null;
        snapshot: unknown;
        includeDiff: boolean;
        includeSteps: boolean;
    }): Promise<AgentTaskShareRow> {
        const r = await this.query<AgentTaskShareRow>(
            `INSERT INTO agent_task_shares
                (share_id, task_id, owner_user_id, visibility, share_token, snapshot, include_diff, include_steps)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
             ON CONFLICT (task_id) DO UPDATE SET
                visibility = EXCLUDED.visibility,
                share_token = EXCLUDED.share_token,
                snapshot = EXCLUDED.snapshot,
                include_diff = EXCLUDED.include_diff,
                include_steps = EXCLUDED.include_steps,
                updated_at = NOW()
             RETURNING *`,
            [
                params.shareId, params.taskId, params.ownerUserId, params.visibility,
                params.shareToken, JSON.stringify(params.snapshot),
                params.includeDiff, params.includeSteps,
            ],
        );
        return r.rows[0]!;
    }

    async getByShareId(shareId: string): Promise<AgentTaskShareRow | undefined> {
        const r = await this.query<AgentTaskShareRow>(
            'SELECT * FROM agent_task_shares WHERE share_id = $1', [shareId]);
        return r.rows[0];
    }

    async getByTaskId(taskId: string): Promise<AgentTaskShareRow | undefined> {
        const r = await this.query<AgentTaskShareRow>(
            'SELECT * FROM agent_task_shares WHERE task_id = $1', [taskId]);
        return r.rows[0];
    }

    /** 공유 해제 — 이후 조회는 404. 소유자 검증은 호출측(라우트)이 한다. */
    async deleteByTaskId(taskId: string): Promise<boolean> {
        const r = await this.query('DELETE FROM agent_task_shares WHERE task_id = $1', [taskId]);
        return (r.rowCount ?? 0) > 0;
    }
}
