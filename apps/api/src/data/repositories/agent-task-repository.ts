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
        /** 입력 첨부 파일(추출 텍스트+원본 base64) — [{name,type,content,data,size,truncated,extracted}] */
        inputFiles?: unknown;
        /** 입력 첨부 이미지(dataURL 배열) — vision 주입 + 샌드박스 기록용 */
        inputImages?: unknown;
    }): Promise<void> {
        // input_files/input_images 는 첨부가 있을 때만 컬럼에 포함 — 056/057 마이그레이션
        // 미적용 배포에서도 첨부 없는 기존 생성 경로가 깨지지 않게 한다(2단계 배포 안전).
        const cols = ['id', 'user_id', 'goal', 'max_turns', 'model'];
        const values: QueryParam[] = [params.id, params.userId, params.goal, params.maxTurns ?? 10, params.model];
        if (params.inputFiles !== undefined) {
            cols.push('input_files');
            values.push(JSON.stringify(params.inputFiles));
        }
        if (params.inputImages !== undefined) {
            cols.push('input_images');
            values.push(JSON.stringify(params.inputImages));
        }
        await this.query(
            `INSERT INTO agent_tasks (${cols.join(', ')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')})`,
            values
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
        totalTokens?: number;
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
            // null 은 SQL NULL 로 저장(완료 시 checkpoint 제거) — 'null'::jsonb 가 아닌 진짜 NULL.
            params.push(updates.checkpoint === null ? null : JSON.stringify(updates.checkpoint));
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
        if (updates.totalTokens !== undefined) {
            sets.push(`total_tokens = $${paramIdx++}`);
            params.push(updates.totalTokens);
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

    /** 작업의 스텝 전체 삭제 — 실패/취소 작업을 처음부터 재실행할 때 이전 시도의 스텝을 비운다
     *  (stepNumber 0 재시작으로 인한 (task_id, step_number) 중복·표시 혼선 방지). */
    async deleteAgentTaskSteps(taskId: string): Promise<void> {
        await this.query('DELETE FROM agent_task_steps WHERE task_id = $1', [taskId]);
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

    /**
     * 부팅 복구 대상 조회 — 재시작으로 in-process 루프가 소멸한 task.
     * schema-initializer 가 부팅 시 running/paused 를 failed('server restarted') 로 먼저 마킹하므로
     * 실제 대상은 대부분 ②다: ①잔존 running/paused(마킹 실패 대비) ②restart 마킹 + 최근 window 내
     * (과거 재시작이 남긴 오래된 failed 는 자동 resume 하지 않음 — 수동 resume 대상).
     * 오래된 것부터 복구(updated_at ASC).
     */
    async getInterruptedAgentTasks(windowMs: number): Promise<AgentTask[]> {
        const result = await this.query<AgentTask>(
            `SELECT * FROM agent_tasks
             WHERE status IN ('running', 'paused')
                OR (status = 'failed' AND error = 'server restarted'
                    AND completed_at > NOW() - make_interval(secs => $1))
             ORDER BY updated_at ASC`,
            [windowMs / 1000]
        );
        return result.rows;
    }

    /**
     * 복구 소유권 원자적 획득 — 복구 대상 상태인 task 만 pending 으로 전이하고 rowCount 로
     * 성공 여부 반환. 다중 프로세스가 동시에 복구를 시도해도 조건부 UPDATE 가 한 번만
     * 성공(나머지는 rowCount=0)해 이중 실행을 막는다. restart 마킹의 error/completed_at 도
     * 함께 정리(재개 task 가 목록에서 '실패·완료시각'으로 보이지 않게).
     */
    async claimAgentTaskForRecovery(taskId: string): Promise<boolean> {
        const result = await this.query(
            `UPDATE agent_tasks
             SET status = 'pending', error = NULL, completed_at = NULL, updated_at = NOW()
             WHERE id = $1 AND (status IN ('running', 'paused')
                OR (status = 'failed' AND error = 'server restarted'))`,
            [taskId]
        );
        return (result.rowCount ?? 0) > 0;
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
