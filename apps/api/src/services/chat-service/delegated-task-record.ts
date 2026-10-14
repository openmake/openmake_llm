/**
 * 채팅 턴에서 위임한 백그라운드 작업 기록 (2026-10-14).
 *
 * delegate_agent_task 로 만든 작업의 완료 알림은 WS 이벤트·웹 푸시뿐이라 REST 클라이언트(Discord 봇)는
 * 결과를 받을 통로가 없었다. 이번 턴에 만들었거나 재사용한 작업을 요청 컨텍스트(ctx.delegatedTasks)에 남기면
 * 호출부가 REST 응답의 message.agent_tasks 로 내보내고, 클라이언트가 그 작업을 지켜본다.
 *
 * 실행 함수(runOrchestrationTool)는 ctx 를 받지 않으므로 도구 결과 JSON({task_id, status?})을 읽어 채운다 —
 * 실행부 시그니처를 바꾸지 않는다.
 *
 * @module services/chat-service/delegated-task-record
 */
import { DELEGATE_AGENT_TASK_TOOL_NAME } from './orchestration-dispatch';

/** 이번 턴에 위임한 작업 — created: 새로 만듦, duplicate: 같은 목표의 기존 작업을 재사용 */
export interface DelegatedTaskRecord {
    id: string;
    goal: string;
    status: 'created' | 'duplicate';
}

/** 위임 도구 결과를 ctx.delegatedTasks 에 남긴다. 실패·다른 도구·이미 기록한 작업은 건너뛴다. */
export function recordDelegatedTask(
    ctx: { delegatedTasks?: DelegatedTaskRecord[] },
    toolName: string,
    args: Record<string, unknown>,
    toolResult: string,
): void {
    if (toolName !== DELEGATE_AGENT_TASK_TOOL_NAME) return;
    let parsed: unknown;
    try {
        parsed = JSON.parse(toolResult);
    } catch {
        return; // 'Error: …' 등 실패 문자열
    }
    const taskId = parsed && typeof parsed === 'object' ? (parsed as { task_id?: unknown }).task_id : undefined;
    if (typeof taskId !== 'string' || !taskId) return;
    const list = (ctx.delegatedTasks ??= []);
    if (list.some((t) => t.id === taskId)) return;
    list.push({
        id: taskId,
        goal: String(args.goal ?? '').trim(),
        status: (parsed as { status?: unknown }).status === 'duplicate' ? 'duplicate' : 'created',
    });
}
