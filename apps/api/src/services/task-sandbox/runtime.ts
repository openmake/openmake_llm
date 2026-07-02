/**
 * ============================================================
 * Task Runtime — 샌드박스 + 도구 + 승인 게이트 통합 (Manus화 Phase 1 / C1)
 * ============================================================
 *
 * AgentTaskService 가 task 시작 시 1개 생성한다. 영속 샌드박스 수명주기 +
 * task-scoped 도구(LLM 형식) 노출 + 도구 실행 시 HITL 승인 게이트 적용을 캡슐화.
 *
 * @module services/task-sandbox/runtime
 */
import type { ToolDefinition } from '../../llm/types';
import type { MCPToolDefinition } from '../../mcp/types';
import { getTaskSandboxConfig, type TaskSandboxConfig } from '../../config/task-sandbox';
import { TaskSandbox } from './sandbox';
import { createTaskTools, type DelegateFn } from './tools';
import { TaskPlan, type PlanStep } from './planning';
import { requiresApproval, getApprovalRegistry, type PendingApproval } from './approval-gate';
import { createLogger } from '../../utils/logger';

const logger = createLogger('TaskRuntime');

/** MCPToolDefinition → LLM ToolDefinition 어댑터. */
export function toLLMTool(def: MCPToolDefinition): ToolDefinition {
    return {
        type: 'function',
        function: {
            name: def.tool.name,
            description: def.tool.description,
            parameters: def.tool.inputSchema as ToolDefinition['function']['parameters'],
        },
    };
}

function resultToString(r: { content: Array<{ text?: string }>; isError?: boolean }, cap = 8000): string {
    const text = r.content.map((c) => c.text ?? '').join('\n').slice(0, cap);
    return r.isError ? `Error: ${text}` : text;
}

export interface ExecuteTaskToolOpts {
    signal?: AbortSignal;
    /** 승인 대기 진입 시 호출 — 호출부가 status='paused' + web-push/WS 발행. */
    onApprovalPending?: (p: PendingApproval) => void;
}

export class TaskRuntime {
    readonly taskId: string;
    readonly userId: string;
    private readonly cfg: TaskSandboxConfig;
    private readonly sandbox: TaskSandbox;
    private readonly plan = new TaskPlan();
    private readonly handlers = new Map<string, MCPToolDefinition['handler']>();
    private readonly defs: MCPToolDefinition[];

    constructor(
        taskId: string,
        userId: string,
        cfg: TaskSandboxConfig = getTaskSandboxConfig(),
        delegate?: DelegateFn,
    ) {
        this.taskId = taskId;
        this.userId = userId;
        this.cfg = cfg;
        this.sandbox = new TaskSandbox(taskId, cfg);
        this.defs = createTaskTools(this.sandbox, this.plan, delegate);
        for (const d of this.defs) this.handlers.set(d.tool.name, d.handler);
    }

    /** 현재 실행 계획 스냅샷 (진행 가시성·영속용). */
    getPlanSnapshot(): PlanStep[] { return this.plan.snapshot(); }

    get containerName(): string { return this.sandbox.containerName; }
    get workspacePath(): string { return this.sandbox.hostWorkdir; }

    async create(): Promise<void> { await this.sandbox.create(); }
    /** removeWorkspace=false 면 산출물 다운로드를 위해 workspace 보존(컨테이너만 제거). */
    async cleanup(removeWorkspace = true): Promise<void> { await this.sandbox.cleanup(removeWorkspace); }
    /** 산출물 회수용 — workspace 파일 목록(상대경로, 재귀). */
    async listWorkspace(): Promise<string[]> { return this.sandbox.listWorkspaceFiles(); }

    /** task-scoped 도구를 LLM 형식으로. AgentTaskService 가 effectiveTools 에 합류. */
    getLLMTools(): ToolDefinition[] { return this.defs.map(toLLMTool); }

    isTaskTool(name: string): boolean { return this.handlers.has(name); }

    /**
     * 도구 실행 — 승인 정책 적용 후 핸들러 실행. 거절 시 도구 결과로 거절 메시지 반환
     * (루프는 정상 진행 — LLM 이 거절을 보고 대안을 모색).
     */
    async executeTaskTool(
        name: string,
        args: Record<string, unknown>,
        opts: ExecuteTaskToolOpts = {},
    ): Promise<string> {
        const handler = this.handlers.get(name);
        if (!handler) return `Error: 알 수 없는 task 도구 ${name}`;

        // ask_human 은 승인 정책과 무관하게 항상 사용자 응답을 대기한다 — 도구의 목적 자체가
        // HITL 이므로 승인 레지스트리(pause + push + REST approve/reject)를 응답 채널로 사용.
        // (자유 텍스트 답변 채널은 미구현 — 승인/거절 이진 응답만 전달된다.)
        if (name === 'ask_human') {
            const question = String(args.question ?? '');
            const decision = await getApprovalRegistry().request(
                { taskId: this.taskId, userId: this.userId, toolName: name, args },
                { timeoutMs: this.cfg.approvalTimeoutMs, signal: opts.signal, onPending: opts.onApprovalPending },
            );
            return decision === 'approved'
                ? `사용자가 승인했습니다(계속 진행). 질문: ${question}`
                : `사용자가 거절했거나 응답 시간이 초과되었습니다(질문: ${question}). 이 방향을 중단하고 대안을 시도하거나 terminate 로 마무리하세요.`;
        }

        if (requiresApproval(this.cfg.approvalPolicy, name, args)) {
            const decision = await getApprovalRegistry().request(
                { taskId: this.taskId, userId: this.userId, toolName: name, args },
                { timeoutMs: this.cfg.approvalTimeoutMs, signal: opts.signal, onPending: opts.onApprovalPending },
            );
            if (decision !== 'approved') {
                return `Error: 사용자가 도구 실행을 승인하지 않았습니다 (${name}). 다른 방법을 시도하거나 작업을 종료하세요.`;
            }
        }

        try {
            const r = await handler(args, { userId: this.userId, role: 'user' });
            return resultToString(r as { content: Array<{ text?: string }>; isError?: boolean });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`[${this.taskId}] task 도구 실행 실패 (${name}): ${msg}`);
            return `Error: ${msg}`;
        }
    }
}
