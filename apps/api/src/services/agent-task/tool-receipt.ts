/**
 * 외부 도구 실행 영수증·멱등 키 (175).
 *
 * 호스트에서 도는 외부 도구(MCP·내장 외부 API — 위험 등급 `external`)는 샌드박스 밖에 부작용을 남긴다(메일 발송·문서 생성 등).
 * 호출마다 영수증(agent_task_tool_receipts)을 남겨 "언제 시작했고 어떻게 끝났는지"를 작업 기록과 별개로 보존하고,
 * 작업·호출 id 로 정해지는 멱등 키를 외부 MCP 서버에 함께 보낸다 — 같은 호출을 다시 실행해도 키가 같아
 * 키를 지원하는 서버는 중복을 스스로 막는다.
 *
 * 저장 실패는 실행을 막지 않는다(fail-open, 경고 로그).
 *
 * @module services/agent-task/tool-receipt
 */
import { createHash } from 'crypto';
import { getPool } from '../../data/models/unified-database';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { classifyToolRisk } from '../../config/tool-policy';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskToolReceipt');

/** 영수증 상태 — started 로 시작해 하나로 끝난다. outcome_unknown: 실행 도중 끊겼고 다시 실행하지 않았다. */
export type ToolReceiptStatus = 'started' | 'succeeded' | 'failed' | 'outcome_unknown';

/** PURE: 작업·호출로 정해지는 멱등 키 — 다시 실행해도 같다. */
export function toolIdempotencyKey(taskId: string, toolCallId: string): string {
    return createHash('sha256').update(`${taskId}\n${toolCallId}`).digest('hex').slice(0, 32);
}

/** PURE: 영수증 대상인가 — 위험 등급 external(표 밖 도구: MCP·호스트 내장 외부 API). */
export function needsReceipt(toolName: string, args: Record<string, unknown>): boolean {
    return classifyToolRisk(toolName, args) === 'external';
}

/** PURE: 도구 결과 문자열 → 영수증 상태. 도구 실행 경로는 실패를 `Error: ` 접두로 돌려준다(task-steps.runTool). */
export function receiptStatusOf(toolResult: string): ToolReceiptStatus {
    return toolResult.startsWith('Error:') ? 'failed' : 'succeeded';
}

/** 영수증을 started 로 남기고 멱등 키를 돌려준다(다시 실행이면 같은 행을 started 로 되돌리고 시도 횟수를 올린다). */
export async function startReceipt(taskId: string, toolCallId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const idempotencyKey = toolIdempotencyKey(taskId, toolCallId);
    try {
        await new AgentTaskRepository(getPool()).startToolReceipt({
            taskId, toolCallId, toolName, idempotencyKey,
            argsHash: createHash('sha256').update(JSON.stringify(args ?? {})).digest('hex'),
        });
    } catch (e) {
        logger.warn(`[${taskId}] 실행 영수증 기록 실패 (무시): ${e instanceof Error ? e.message : e}`);
    }
    return idempotencyKey;
}

export async function finishReceipt(taskId: string, toolCallId: string, status: ToolReceiptStatus): Promise<void> {
    try {
        await new AgentTaskRepository(getPool()).finishToolReceipt(taskId, toolCallId, status);
    } catch (e) {
        logger.warn(`[${taskId}] 실행 영수증 종료 기록 실패 (무시): ${e instanceof Error ? e.message : e}`);
    }
}
