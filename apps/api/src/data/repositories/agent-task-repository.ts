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
import { allowedSources, AgentTaskTransitionError } from '../../services/agent-task/task-state';

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
        /** Cowork D1a: 실행 백엔드 — 'sandbox'(기본) | 'local'(로컬 브리지) */
        executor?: 'sandbox' | 'local';
        /** 로컬 실행 대상 브리지 디바이스 (다중 디바이스, 093) — 미지정은 최근 접속 디바이스 폴백 */
        deviceId?: string;
        /** 로컬 실행 대상 폴더 (102) — 연결 루트 기준 상대경로. 미지정은 루트 */
        folderRel?: string;
    }): Promise<void> {
        // input_files/input_images 는 값이 있을 때만 컬럼에 포함 — 056/057 마이그레이션
        // 미적용 배포에서도 해당 값 없는 기존 생성 경로가 깨지지 않게 한다(2단계 배포 안전).
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
        if (params.executor !== undefined) {
            cols.push('executor');
            values.push(params.executor);
        }
        if (params.deviceId !== undefined) {
            cols.push('device_id');
            values.push(params.deviceId);
        }
        if (params.folderRel !== undefined) {
            cols.push('folder_rel');
            values.push(params.folderRel);
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
        /** null = 이전 시도의 실패 사유 제거(재개/재실행으로 완료된 작업). undefined = 변경 없음. */
        error?: string | null;
        checkpoint?: unknown;
        sandboxContainerId?: string;
        workspacePath?: string;
        plan?: unknown;
        totalTokens?: number;
        /** 완료 출구 구분(091) — 'final_answer' | 'terminate'. 완료 판정 관측용 */
        completionPath?: string;
        /** goal judge 결과(091) — 'achieved' | 'not_achieved' | 'unknown' | 'skipped' */
        judgeVerdict?: string;
        /** 상태 전이 사유(124 이벤트) — 미지정 시 error 문자열을 쓴다. */
        transitionReason?: string;
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
            sets.push('plan_version = plan_version + 1'); // 139 — 모든 plan 갱신에서 +1 (UI stale 감지)
        }
        if (updates.totalTokens !== undefined) {
            sets.push(`total_tokens = $${paramIdx++}`);
            params.push(updates.totalTokens);
        }
        if (updates.completionPath !== undefined) {
            sets.push(`completion_path = $${paramIdx++}`);
            params.push(updates.completionPath);
        }
        if (updates.judgeVerdict !== undefined) {
            sets.push(`judge_verdict = $${paramIdx++}`);
            params.push(updates.judgeVerdict);
        }

        params.push(taskId);
        if (!updates.status) {
            await this.query(`UPDATE agent_tasks SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
            return;
        }
        // 상태 머신 강제(124): 허용 출발 상태에서만 전이하고 이전 상태를 RETURNING 으로 받아 이벤트를
        // 남긴다. 표 밖 전이는 rowCount=0 → 현재 상태를 읽어 거부(throw). 규칙은 task-state.ts 한 곳.
        params.push(allowedSources(updates.status));
        const r = await this.query<{ prev: AgentTaskStatus }>(
            `UPDATE agent_tasks t SET ${sets.join(', ')}
             FROM (SELECT id, status AS prev FROM agent_tasks WHERE id = $${paramIdx} FOR UPDATE) o
             WHERE t.id = o.id AND o.prev = ANY($${paramIdx + 1}::text[])
             RETURNING o.prev`,
            params,
        );
        if ((r.rowCount ?? 0) === 0) {
            const cur = await this.query<{ status: string }>('SELECT status FROM agent_tasks WHERE id = $1', [taskId]);
            if (!cur.rows[0]) return; // 삭제된 작업 — 종전에도 no-op 이었다
            throw new AgentTaskTransitionError(taskId, cur.rows[0].status, updates.status);
        }
        const prev = r.rows[0]?.prev;
        if (prev !== updates.status) await this.recordEvent(taskId, prev, updates.status, updates.transitionReason ?? updates.error ?? undefined);
    }

    /** 턴 체크포인트 이력(141) 1행 + 초과분 정리 — fail-open 은 호출부. */
    async insertCheckpointHistory(taskId: string, turn: number, conversation: unknown[], plan: unknown | null, keep: number): Promise<void> {
        await this.query(
            `INSERT INTO agent_task_checkpoints (task_id, turn, conversation, plan) VALUES ($1, $2, $3::jsonb, $4::jsonb)
             ON CONFLICT (task_id, turn) DO UPDATE SET conversation = EXCLUDED.conversation, plan = EXCLUDED.plan, created_at = NOW()`,
            [taskId, turn, JSON.stringify(conversation), plan == null ? null : JSON.stringify(plan)],
        );
        await this.query(
            `DELETE FROM agent_task_checkpoints WHERE task_id = $1 AND id NOT IN (
                 SELECT id FROM agent_task_checkpoints WHERE task_id = $1 ORDER BY turn DESC LIMIT $2)`,
            [taskId, keep],
        );
    }

    async listCheckpoints(taskId: string): Promise<Array<{ turn: number; messages: number; created_at: string }>> {
        const r = await this.query<{ turn: number; messages: string; created_at: string }>(
            `SELECT turn, jsonb_array_length(conversation)::text AS messages, created_at FROM agent_task_checkpoints WHERE task_id = $1 ORDER BY turn ASC`, [taskId]);
        return r.rows.map((x) => ({ turn: x.turn, messages: Number(x.messages), created_at: x.created_at }));
    }

    async getCheckpoint(taskId: string, turn: number): Promise<{ conversation: unknown[]; plan: unknown | null } | null> {
        const r = await this.query<{ conversation: unknown[]; plan: unknown | null }>(
            'SELECT conversation, plan FROM agent_task_checkpoints WHERE task_id = $1 AND turn = $2', [taskId, turn]);
        return r.rows[0] ?? null;
    }

    /** fork 표시(141) — 새 작업에 원 작업·턴을 기록. */
    async markForked(taskId: string, fromTaskId: string, fromTurn: number): Promise<void> {
        await this.query('UPDATE agent_tasks SET forked_from_task_id = $2, forked_from_turn = $3 WHERE id = $1', [taskId, fromTaskId, fromTurn]);
    }

    /** 사용자 계획 편집(139) — expectedVersion 이 현재와 같을 때만 갱신. 반환 ok=false 면 현재 버전. */
    async updatePlanIfVersion(taskId: string, plan: unknown[], expectedVersion: number): Promise<{ ok: boolean; version: number }> {
        const r = await this.query<{ plan_version: number }>(
            `UPDATE agent_tasks SET plan = $2, plan_version = plan_version + 1, updated_at = NOW()
             WHERE id = $1 AND plan_version = $3 RETURNING plan_version`,
            [taskId, JSON.stringify(plan), expectedVersion],
        );
        if (r.rows[0]) return { ok: true, version: r.rows[0].plan_version };
        const cur = await this.query<{ plan_version: number }>('SELECT plan_version FROM agent_tasks WHERE id = $1', [taskId]);
        return { ok: false, version: cur.rows[0]?.plan_version ?? 0 };
    }

    /** 상태 전이 이벤트 1행(124) — 관측용이라 실패해도 전이를 되돌리지 않는다(fail-open). */
    async recordEvent(taskId: string, from: string | null | undefined, to: string, reason?: string): Promise<void> {
        await this.query(
            'INSERT INTO agent_task_events (task_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4)',
            [taskId, from ?? null, to, reason ?? null],
        ).catch(() => { /* 이벤트 기록 실패는 작업을 막지 않는다 */ });
    }

    async getAgentTaskEvents(taskId: string, limit = 200): Promise<Array<{ id: number; from_status: string | null; to_status: string; reason: string | null; created_at: string }>> {
        const r = await this.query<{ id: number; from_status: string | null; to_status: string; reason: string | null; created_at: string }>(
            'SELECT id, from_status, to_status, reason, created_at FROM agent_task_events WHERE task_id = $1 ORDER BY id ASC LIMIT $2',
            [taskId, limit],
        );
        return r.rows;
    }

    /** "나머지 모두 승인" 플래그 영속(124) — 재시작 후 재개된 작업이 승인을 다시 묻지 않게. */
    async setAutoApprove(taskId: string, enabled: boolean): Promise<void> {
        await this.query('UPDATE agent_tasks SET auto_approve = $2, updated_at = NOW() WHERE id = $1', [taskId, enabled]);
    }

    /** 도구 호출 저널(124) — tool_call_id → tool_result 본문. 턴 중간 재개가 실행된 호출을 건너뛰는 근거. */
    async getToolCallJournal(taskId: string, toolCallIds: string[]): Promise<Map<string, string>> {
        const r = await this.query<{ tool_call_id: string; content: string | null }>(
            `SELECT tool_call_id, content FROM agent_task_steps
             WHERE task_id = $1 AND step_type = 'tool_result' AND tool_call_id = ANY($2::text[])`,
            [taskId, toolCallIds],
        );
        return new Map(r.rows.map((row) => [row.tool_call_id, row.content ?? '']));
    }

    async addAgentTaskStep(params: {
        taskId: string;
        stepNumber: number;
        stepType: string;
        toolName?: string;
        content?: string;
        messagesSnapshot?: unknown;
        status?: string;
        /** 스텝 기록 시점의 in_progress 플랜 단계 인덱스(0-base) — 노드별 비용/정합 집계(088). */
        planStepIndex?: number;
        /** 도구 호출 인자(091) — 호출부에서 마스킹·크기 캡을 적용한 값만 넘긴다. */
        toolArgs?: unknown;
        /** tool_result 스텝의 원 tool_call id(124 저널). */
        toolCallId?: string;
    }): Promise<void> {
        // NUL(0x00) 제거 — 바이너리 파일을 도구로 열람하면 도구 결과에 0x00 이 섞일 수 있고,
        // Postgres TEXT/JSON 은 이를 거부한다("invalid byte sequence for encoding UTF8: 0x00").
        // 저장 backstop 으로 content·messages_snapshot 모두 정화한다(resultToString 소스 차단과 병행).
        const stripNul = (s: string): string => s.replace(/\u0000/g, '');
        await this.query(
            `INSERT INTO agent_task_steps (task_id, step_number, step_type, tool_name, content, messages_snapshot, status, plan_step_index, tool_args, tool_call_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                params.taskId,
                params.stepNumber,
                params.stepType,
                params.toolName,
                params.content != null ? stripNul(params.content) : params.content,
                params.messagesSnapshot !== undefined ? stripNul(JSON.stringify(params.messagesSnapshot)) : null,
                params.status || 'completed',
                params.planStepIndex ?? null,
                params.toolArgs !== undefined ? stripNul(JSON.stringify(params.toolArgs)) : null,
                params.toolCallId ?? null,
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

    /** 관리자 전체 조회(/admin/conversations) — user_id 포함, 최신순. */
    async getAllAgentTasks(limit: number = 200): Promise<AgentTask[]> {
        const result = await this.query<AgentTask>(
            'SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT $1',
            [limit]
        );
        return result.rows;
    }

    /** 크로스-task 학습(5-2)용 — 유저 최근 terminal task 의 경량 메타만 조회(checkpoint 등 대형 컬럼 제외). */
    async getRecentTerminalTaskMetas(userId: string, limit: number): Promise<Array<
        Pick<AgentTask, 'id' | 'goal' | 'status' | 'error' | 'current_turn'>
    >> {
        const result = await this.query<Pick<AgentTask, 'id' | 'goal' | 'status' | 'error' | 'current_turn'>>(
            `SELECT id, goal, status, error, current_turn FROM agent_tasks
             WHERE user_id = $1 AND status IN ('completed', 'failed', 'cancelled')
             ORDER BY created_at DESC LIMIT $2`,
            [userId, limit]
        );
        return result.rows;
    }

    /** 크로스-task 학습(5-2)용 — task 가 실제 사용한 도구 이름 목록(distinct). */
    async getTaskToolNames(taskId: string): Promise<string[]> {
        const result = await this.query<{ tool_name: string }>(
            `SELECT DISTINCT tool_name FROM agent_task_steps
             WHERE task_id = $1 AND tool_name IS NOT NULL AND step_type = 'tool_result'`,
            [taskId]
        );
        return result.rows.map((r) => r.tool_name);
    }

    /**
     * 부팅 복구 대상 조회 — 재시작으로 in-process 루프가 소멸한 task.
     * schema-initializer 가 부팅 시 running/paused 를 failed('server restarted') 로 먼저 마킹하므로
     * 실제 대상은 대부분 ②다: ①잔존 running/paused(마킹 실패 대비) ②restart 마킹 + 최근 window 내
     * (과거 재시작이 남긴 오래된 failed 는 자동 resume 하지 않음 — 수동 resume 대상).
     * 오래된 것부터 복구(updated_at ASC).
     *
     * 'queued' 도 포함한다 — 큐(3-B)는 인메모리라 재시작하면 대기열이 증발하는데, DB 행은
     * 'queued' 로 남아 UI 가 영구 '대기 중' 을 그리고 아무도 실행하지 않았다(2026-08-25 발견).
     * queued 는 시작한 적이 없으므로 checkpoint 없이 처음부터 다시 디스패치한다.
     */
    async getInterruptedAgentTasks(windowMs: number): Promise<AgentTask[]> {
        const result = await this.query<AgentTask>(
            `SELECT * FROM agent_tasks
             WHERE status IN ('running', 'paused', 'queued')
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
        const result = await this.query<{ prev: string }>(
            `UPDATE agent_tasks t
             SET status = 'pending', error = NULL, completed_at = NULL, updated_at = NOW()
             FROM (SELECT id, status AS prev FROM agent_tasks WHERE id = $1 FOR UPDATE) o
             WHERE t.id = o.id AND (o.prev IN ('running', 'paused', 'queued')
                OR (o.prev = 'failed' AND t.error = 'server restarted'))
             RETURNING o.prev`,
            [taskId]
        );
        if ((result.rowCount ?? 0) === 0) return false;
        await this.recordEvent(taskId, result.rows[0]?.prev, 'pending', 'boot recovery claim');
        return true;
    }

    /** 활성 상태별 건수 — 큐 관측(/queue/stats) 용. 인메모리 큐 스냅샷과 대조해 재시작 고아를 드러낸다. */
    async countActiveAgentTasksByStatus(): Promise<Record<'queued' | 'running' | 'paused' | 'pending', number>> {
        const r = await this.query<{ status: string; n: string }>(
            `SELECT status, COUNT(*)::text AS n FROM agent_tasks
              WHERE status IN ('queued', 'running', 'paused', 'pending') GROUP BY status`,
        );
        const out = { queued: 0, running: 0, paused: 0, pending: 0 };
        for (const row of r.rows) {
            if (row.status in out) out[row.status as keyof typeof out] = parseInt(row.n, 10);
        }
        return out;
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
