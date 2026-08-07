/**
 * @module data/repositories/agent-task-metrics-repository
 * @description 에이전트 작업 도구 실행 오류 관측용 읽기 전용 집계 계층
 *
 * `agent_task_steps` 의 도구 실행 결과(step_type='tool_result') 중 오류(content LIKE 'Error:%')를
 * 관리자 대시보드에서 볼 수 있도록 집계한다. 도구 오류는 이전까지 어디에도 집계되지 않아
 * 운영자가 관측할 수 없었다.
 *
 * - 기간별 도구 오류 요약(총 실행 수·오류 수·오류율, 오류 발생 작업 수와 상태 분포)
 * - 오류 시그니처 상위 N (content 앞부분 정규화 기준 GROUP BY)
 * - tool_name 별 오류 수 (tool_name 은 088 마이그레이션 이후 스텝에만 존재)
 *
 * 전부 파라미터화 쿼리, read-only. 숫자 파싱(COUNT 는 문자열로 옴)은 응답 조립부에 남긴다.
 */
import { BaseRepository } from './base-repository';

/** 도구 실행 오류 요약 (총량/오류율/작업 분포) */
export interface ToolErrorSummaryRow {
    total_tool_executions: string;
    error_count: string;
    affected_tasks: string;
}

/** 오류 발생 작업의 결말(status) 분포 */
export interface ToolErrorTaskStatusRow {
    status: string;
    tasks: string;
}

/** 오류 시그니처(정규화된 content 앞부분)별 건수 */
export interface ToolErrorSignatureRow {
    signature: string;
    count: string;
}

/** tool_name 별 오류 건수 */
export interface ToolErrorByToolRow {
    tool_name: string;
    count: string;
}

export class AgentTaskMetricsRepository extends BaseRepository {
    /**
     * 기간별 도구 오류 요약 — 총 도구 실행 수, 오류 수, 오류 발생 고유 작업 수.
     * 오류율은 응답 조립부에서 error_count / total 로 계산한다.
     */
    async getToolErrorSummary(days: number): Promise<ToolErrorSummaryRow> {
        const result = await this.query<ToolErrorSummaryRow>(
            `SELECT
                    COUNT(*) FILTER (WHERE step_type = 'tool_result') AS total_tool_executions,
                    COUNT(*) FILTER (WHERE step_type = 'tool_result' AND content LIKE 'Error:%') AS error_count,
                    COUNT(DISTINCT task_id) FILTER (WHERE step_type = 'tool_result' AND content LIKE 'Error:%') AS affected_tasks
             FROM agent_task_steps
             WHERE created_at >= NOW() - ($1 || ' days')::interval`,
            [String(days)]
        );
        return result.rows[0] ?? { total_tool_executions: '0', error_count: '0', affected_tasks: '0' };
    }

    /** 오류 발생 작업의 status 분포 (completed/failed/cancelled 등) — 결말 구분 */
    async getToolErrorTaskStatusDistribution(days: number): Promise<ToolErrorTaskStatusRow[]> {
        const result = await this.query<ToolErrorTaskStatusRow>(
            `SELECT t.status AS status,
                    COUNT(DISTINCT t.id) AS tasks
             FROM agent_tasks t
             JOIN agent_task_steps s ON s.task_id = t.id
             WHERE s.step_type = 'tool_result'
               AND s.content LIKE 'Error:%'
               AND s.created_at >= NOW() - ($1 || ' days')::interval
             GROUP BY t.status
             ORDER BY tasks DESC`,
            [String(days)]
        );
        return result.rows;
    }

    /**
     * 오류 시그니처 상위 N — content 첫 줄 앞 120자 기준으로 GROUP BY.
     * (첫 줄만 남기면 개별 스택트레이스/경로 차이를 뭉개 유사 오류를 묶는다.)
     */
    async getToolErrorSignatures(days: number, limit: number): Promise<ToolErrorSignatureRow[]> {
        const result = await this.query<ToolErrorSignatureRow>(
            `SELECT left(regexp_replace(content, E'\\n.*', '', 'g'), 120) AS signature,
                    COUNT(*) AS count
             FROM agent_task_steps
             WHERE step_type = 'tool_result'
               AND content LIKE 'Error:%'
               AND created_at >= NOW() - ($1 || ' days')::interval
             GROUP BY 1
             ORDER BY count DESC, signature
             LIMIT $2`,
            [String(days), limit]
        );
        return result.rows;
    }

    /** tool_name 별 오류 수 (tool_name 이 있는 행만 — 088 이후 스텝) */
    async getToolErrorByToolName(days: number, limit: number): Promise<ToolErrorByToolRow[]> {
        const result = await this.query<ToolErrorByToolRow>(
            `SELECT tool_name,
                    COUNT(*) AS count
             FROM agent_task_steps
             WHERE step_type = 'tool_result'
               AND content LIKE 'Error:%'
               AND tool_name IS NOT NULL
               AND created_at >= NOW() - ($1 || ' days')::interval
             GROUP BY tool_name
             ORDER BY count DESC, tool_name
             LIMIT $2`,
            [String(days), limit]
        );
        return result.rows;
    }
}
