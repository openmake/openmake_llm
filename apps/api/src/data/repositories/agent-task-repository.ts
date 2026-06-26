/**
 * @module data/repositories/agent-task-repository
 * @description `agent_tasks` / `agent_task_steps` 테이블 데이터 접근 계층
 *
 * 자율 에이전트 작업(AgentTask)과 작업 단계(AgentTaskStep) 엔티티의 CRUD를 담당합니다.
 * - 작업 생성/조회/갱신, 사용자별 작업 목록
 * - 턴별 체크포인트 단계 기록 (assistant 응답, tool 호출/결과)
 * - 작업 상태(대기/진행중/완료/실패/취소) 관리
 *
 * research-repository.ts 와 동일 패턴 — 백그라운드 detached 실행의 진행상황을
 * DB 에 영속하여 연결이 끊겨도 taskId 로 복구 조회 가능하게 한다.
 */
import { BaseRepository, QueryParam } from './base-repository';
import type { AgentTask, AgentTaskStatus, AgentTaskStep } from '../models/unified-database.types';

export class AgentTaskRepository extends BaseRepository {
    async createAgentTask(params: {
        id: string;
        userId?: string;
        goal: string;
        maxTurns?: number;
        model?: string;
    }): Promise<void> {
        await this.query(
            'INSERT INTO agent_tasks (id, user_id, goal, max_turns, model) VALUES ($1, $2, $3, $4, $5)',
            [params.id, params.userId, params.goal, params.maxTurns ?? 10, params.model]
        );
    }

    async getAgentTask(taskId: string): Promise<AgentTask | undefined> {
        const result = await this.query<AgentTask>('SELECT * FROM agent_tasks WHERE id = $1', [taskId]);
        return result.rows[0];
    }

    async updateAgentTask(taskId: string, updates: {
        status?: AgentTaskStatus;
        progress?: number;
        currentTurn?: number;
        result?: string;
        error?: string;
        checkpoint?: unknown;
        sandboxContainerId?: string;
        workspacePath?: string;
        plan?: unknown;
    }): Promise<void> {
        const sets: string[] = ['updated_at = NOW()'];
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (updates.status) {
            sets.push(`status = $${paramIdx++}`);
            params.push(updates.status);
            if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'cancelled') {
                sets.push('completed_at = NOW()');
            }
        }
        if (updates.progress !== undefined) {
            sets.push(`progress = $${paramIdx++}`);
            params.push(updates.progress);
        }
        if (updates.currentTurn !== undefined) {
            sets.push(`current_turn = $${paramIdx++}`);
            params.push(updates.currentTurn);
        }
        if (updates.result !== undefined) {
            sets.push(`result = $${paramIdx++}`);
            params.push(updates.result);
        }
        if (updates.error !== undefined) {
            sets.push(`error = $${paramIdx++}`);
            params.push(updates.error);
        }
        if (updates.checkpoint !== undefined) {
            sets.push(`checkpoint = $${paramIdx++}`);
            params.push(JSON.stringify(updates.checkpoint));
        }
        if (updates.sandboxContainerId !== undefined) {
            sets.push(`sandbox_container_id = $${paramIdx++}`);
            params.push(updates.sandboxContainerId);
        }
        if (updates.workspacePath !== undefined) {
            sets.push(`workspace_path = $${paramIdx++}`);
            params.push(updates.workspacePath);
        }
        if (updates.plan !== undefined) {
            sets.push(`plan = $${paramIdx++}`);
            params.push(JSON.stringify(updates.plan));
        }

        params.push(taskId);
        await this.query(`UPDATE agent_tasks SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
    }

    async addAgentTaskStep(params: {
        taskId: string;
        stepNumber: number;
        stepType: string;
        toolName?: string;
        content?: string;
        messagesSnapshot?: unknown;
        status?: string;
    }): Promise<void> {
        await this.query(
            `INSERT INTO agent_task_steps (task_id, step_number, step_type, tool_name, content, messages_snapshot, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                params.taskId,
                params.stepNumber,
                params.stepType,
                params.toolName,
                params.content,
                params.messagesSnapshot !== undefined ? JSON.stringify(params.messagesSnapshot) : null,
                params.status || 'completed'
            ]
        );
    }

    async getAgentTaskSteps(taskId: string, limit: number = 1000): Promise<AgentTaskStep[]> {
        const result = await this.query<AgentTaskStep>(
            'SELECT * FROM agent_task_steps WHERE task_id = $1 ORDER BY step_number ASC LIMIT $2',
            [taskId, limit]
        );
        return result.rows;
    }

    async getUserAgentTasks(userId: string, limit: number = 20): Promise<AgentTask[]> {
        const result = await this.query<AgentTask>(
            'SELECT * FROM agent_tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
            [userId, limit]
        );
        return result.rows;
    }

    async deleteAgentTaskWithSteps(taskId: string): Promise<void> {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM agent_task_steps WHERE task_id = $1', [taskId]);
            await client.query('DELETE FROM agent_tasks WHERE id = $1', [taskId]);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
