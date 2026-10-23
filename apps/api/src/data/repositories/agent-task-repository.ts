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
import { QueryParam } from './base-repository';
import { withTransaction, type TransactionClient } from '../retry-wrapper';
import type { AgentTask, AgentTaskStatus, AgentTaskStep } from '../models/unified-database.types';
import { allowedSources, AgentTaskTransitionError } from '../../services/agent-task/task-state';
import { classifyAgentTaskFailure } from '../../config/agent-task-failure-class';
import { chainCreateColumns, CLAIM_CONTINUATION_SQL, type AgentTaskChainCreateParams } from './agent-task-chain-repository';
import { AgentTaskLifecycleRepository } from './agent-task-lifecycle-repository';

// 이벤트·주차·복구 claim·실패 큐 뷰는 agent-task-lifecycle-repository.ts (max-lines 가드로 분리, 상속)
export { parkedTaskCondition } from './agent-task-lifecycle-repository';

/** createAgentTask 의 입력 — 이어가기 후속의 원자적 생성(#1473)도 같은 입력으로 같은 열을 만든다. */
export type AgentTaskCreateParams = {
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
    /** 생성 요청의 Idempotency-Key (174) — 같은 사용자·같은 키의 행이 이미 있으면 만들지 않는다 */
    idempotencyKey?: string;
} & AgentTaskChainCreateParams;

/** 이어가기 후속 시드(#1473) — 생성 입력에 더해 후속이 처음부터 가져야 하는 값 전부. lease 가 없으면(소유권 꺼짐) 소유권 열을 비운다. */
export interface ContinuationSuccessorSeed {
    parentTaskId: string;
    create: AgentTaskCreateParams;
    checkpoint: unknown;
    plan?: unknown;
    forkedFromTurn: number;
    approvalPolicy?: string;
    thinkingLevel?: string;
    lease?: { owner: string; leaseMs: number };
}

/** PURE: INSERT 열·값 — createAgentTask 와 후속 원자 생성이 같은 준비를 쓴다(기본값이 갈리지 않게). */
function createColumns(params: AgentTaskCreateParams): { cols: string[]; values: QueryParam[] } {
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
    // 멱등 키도 값이 있을 때만 — 키 없는 생성 경로(스케줄·트리거·분기)는 174 미적용 배포에서도 그대로 돈다.
    if (params.idempotencyKey !== undefined) {
        cols.push('create_idempotency_key');
        values.push(params.idempotencyKey);
    }
    for (const [col, v] of chainCreateColumns(params)) { cols.push(col); values.push(v); } // 장기 실행 체인(188) — 값이 있을 때만
    return { cols, values };
}

export class AgentTaskRepository extends AgentTaskLifecycleRepository {
    async createAgentTask(params: AgentTaskCreateParams): Promise<boolean> {
        const { cols, values } = createColumns(params);
        const insert = `INSERT INTO agent_tasks (${cols.join(', ')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')})`;
        if (params.idempotencyKey === undefined) {
            await this.query(insert, values);
            return true;
        }
        // 같은 (user_id, key) 가 이미 있으면 아무것도 넣지 않는다 — 반환 행이 없으면 중복(호출부가 기존 작업을 돌려준다).
        const result = await this.query<{ id: string }>(
            `${insert} ON CONFLICT (user_id, create_idempotency_key) WHERE create_idempotency_key IS NOT NULL DO NOTHING RETURNING id`,
            values
        );
        return result.rows.length > 0;
    }

    /**
     * 이어가기 후속의 원자적 생성(#1473) — 부모 선점(continued_by_task_id 조건부 UPDATE)과 완전히 시드된 후속 INSERT
     * (체크포인트·plan·fork 표시·실효 승인 정책·추론 수준·실행 소유권)를 한 트랜잭션에 저장한다. 어느 문장이 실패하거나
     * 커밋 전에 프로세스가 죽으면 둘 다 남지 않는다 — 부모 링크가 없는 후속·불완전한 후속을 가리키는 일이 없다.
     * false 면 다른 실행이 먼저 이었다(아무것도 쓰지 않았다). 네트워크·모델·작업 공간 준비는 호출부가 트랜잭션 밖에서 끝낸다.
     */
    async createContinuationSuccessor(seed: ContinuationSuccessorSeed): Promise<boolean> {
        const { cols, values } = createColumns(seed.create);
        const seedCols: Array<[string, QueryParam]> = [
            ['checkpoint', JSON.stringify(seed.checkpoint)],
            ['forked_from_task_id', seed.parentTaskId],
            ['forked_from_turn', seed.forkedFromTurn],
        ];
        if (seed.plan !== undefined && seed.plan !== null) seedCols.push(['plan', JSON.stringify(seed.plan)]);
        if (seed.approvalPolicy) seedCols.push(['approval_policy', seed.approvalPolicy]);
        if (seed.thinkingLevel) seedCols.push(['thinking_level', seed.thinkingLevel]);
        if (seed.lease) seedCols.push(['lease_owner', seed.lease.owner]);
        for (const [col, v] of seedCols) { cols.push(col); values.push(v); }
        const placeholders = values.map((_, i) => `$${i + 1}`);
        if (seed.lease) { // 소유권 만료는 DB 시계 기준 — acquireLease 와 같은 식
            cols.push('lease_until');
            values.push(seed.lease.leaseMs / 1000);
            placeholders.push(`NOW() + make_interval(secs => $${values.length})`);
        }
        const insert = `INSERT INTO agent_tasks (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
        return withTransaction(this.pool as unknown as { connect: () => Promise<TransactionClient> }, async (client) => {
            const claim = await client.query(CLAIM_CONTINUATION_SQL, [seed.parentTaskId, seed.create.id]);
            if ((claim.rowCount ?? 0) !== 1) return false;
            await client.query(insert, values);
            return true;
        });
    }

    /** 생성 멱등 키로 작업 조회(174) — 재시작·다른 서버가 만든 작업도 찾는다. */
    async findAgentTaskByCreateKey(userId: string, key: string): Promise<AgentTask | undefined> {
        const result = await this.query<AgentTask>(
            'SELECT * FROM agent_tasks WHERE user_id = $1 AND create_idempotency_key = $2', [userId, key]);
        return result.rows[0];
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
        /** 캐시 적중 입력 토큰 누적(182) — 모델 서버가 값을 준 적이 없으면 넘기지 않는다(칸은 NULL 로 남는다) */
        cachedPromptTokens?: number;
        /** 캐시 값을 돌려준 호출의 입력 토큰 누적(182) — 적중률의 분모 */
        cacheReportedPromptTokens?: number;
        /** 완료 출구 구분(091) — 'final_answer' | 'terminate'. 완료 판정 관측용 */
        completionPath?: string;
        /** goal judge 결과(091) — 'achieved' | 'not_achieved' | 'unknown' | 'skipped' */
        judgeVerdict?: string;
        /** 상태 전이 사유(124 이벤트) — 미지정 시 error 문자열을 쓴다. */
        transitionReason?: string;
        /** 큐 우선순위(131) */
        priority?: number;
        /** 종료 알림 표식(174) — 종료 상태와 같은 쓰기로 true, 알림을 보낸 뒤 clearTerminalNotifyPending */
        terminalNotifyPending?: boolean;
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
            // 실패 분류(131) — failed 전이에서만 채우고, 다른 전이(재실행·재개)는 지운다
            sets.push(updates.status === 'failed' ? `failure_class = $${paramIdx++}` : 'failure_class = NULL');
            if (updates.status === 'failed') params.push(classifyAgentTaskFailure(updates.error));
        }
        if (updates.terminalNotifyPending !== undefined) {
            sets.push(`terminal_notify_pending = $${paramIdx++}`);
            params.push(updates.terminalNotifyPending);
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
        if (updates.cachedPromptTokens !== undefined) {
            sets.push(`cached_prompt_tokens = $${paramIdx++}`);
            params.push(updates.cachedPromptTokens);
        }
        if (updates.cacheReportedPromptTokens !== undefined) {
            sets.push(`cache_reported_prompt_tokens = $${paramIdx++}`);
            params.push(updates.cacheReportedPromptTokens);
        }
        if (updates.completionPath !== undefined) {
            sets.push(`completion_path = $${paramIdx++}`);
            params.push(updates.completionPath);
        }
        if (updates.judgeVerdict !== undefined) {
            sets.push(`judge_verdict = $${paramIdx++}`);
            params.push(updates.judgeVerdict);
        }
        if (updates.priority !== undefined) {
            sets.push(`priority = $${paramIdx++}`);
            params.push(updates.priority);
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

    /** "나머지 모두 승인" 플래그 영속(124) — 재시작 후 재개된 작업이 승인을 다시 묻지 않게. */
    async setAutoApprove(taskId: string, enabled: boolean): Promise<void> {
        await this.query('UPDATE agent_tasks SET auto_approve = $2, updated_at = NOW() WHERE id = $1', [taskId, enabled]);
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

    /** 크로스-task 학습(5-2)용 — task 가 실제 사용한 도구 이름 목록(distinct). */
    async getTaskToolNames(taskId: string): Promise<string[]> {
        const result = await this.query<{ tool_name: string }>(
            `SELECT DISTINCT tool_name FROM agent_task_steps
             WHERE task_id = $1 AND tool_name IS NOT NULL AND step_type = 'tool_result'`,
            [taskId]
        );
        return result.rows.map((r) => r.tool_name);
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
