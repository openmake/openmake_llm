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
import { TaskSandbox, type ExecResult } from './sandbox';
import type { TaskExecutor } from './executor';
import { createTaskTools, type DelegateFn, type SpawnFn, type ProceduralHooks } from './tools';
import { recordBrowserMetric } from './browser-metrics';
import { AGENT_TASK_LIMITS, ORCHESTRATION_DISPATCH } from '../../config/runtime-limits';
import { saveProceduralSkill, resolveProceduralSpec } from '../agent-task/procedural-skill';
import { TaskPlan, type PlanStep } from './planning';
import { requiresApproval, getApprovalRegistry, type PendingApproval, type ApprovalRejectReason } from './approval-gate';
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
    // NUL(0x00) 제거 — 바이너리 파일을 도구로 열람하면 결과에 0x00 이 섞일 수 있고, 이는 모델
    // 컨텍스트/스텝 저장(Postgres TEXT·JSON)으로 흘러가면 "invalid byte sequence" 로 태스크를 깨뜨린다.
    const text = r.content.map((c) => c.text ?? '').join('\n').replace(/\u0000/g, '').slice(0, cap);
    return r.isError ? `Error: ${text}` : text;
}

export interface ExecuteTaskToolOpts {
    signal?: AbortSignal;
    /** 승인 대기 진입 시 호출 — 호출부가 status='paused' + web-push/WS 발행. */
    onApprovalPending?: (p: PendingApproval) => void;
    /** 승인 대기 종료 시 대기시간(ms) 통지 — pause-aware 타임아웃(4-1)이 총 예산에서 제외. */
    onApprovalWaited?: (ms: number) => void;
    /** 승인 거절 시 사유 통지 — 호출부가 무응답('timeout') 연속 횟수를 세어 HITL 강등 판단. */
    onApprovalRejected?: (info: { toolName: string; reason: ApprovalRejectReason }) => void;
}

export class TaskRuntime {
    readonly taskId: string;
    readonly userId: string;
    private readonly cfg: TaskSandboxConfig;
    private readonly executor: TaskExecutor;
    private readonly plan = new TaskPlan({ autoAdvance: AGENT_TASK_LIMITS.PLAN_AUTO_ADVANCE });
    private readonly handlers = new Map<string, MCPToolDefinition['handler']>();
    private readonly defs: MCPToolDefinition[];

    constructor(
        taskId: string,
        userId: string,
        cfg: TaskSandboxConfig = getTaskSandboxConfig(),
        delegate?: DelegateFn,
        spawn?: SpawnFn,
        /** 실행 백엔드 주입(D1 원격 실행기용). 미지정 시 현행 Docker 샌드박스. */
        executor?: TaskExecutor,
    ) {
        this.taskId = taskId;
        this.userId = userId;
        this.cfg = cfg;
        this.executor = executor ?? new TaskSandbox(taskId, cfg);
        // #1 절차 스킬: 저장/조회 훅을 userId 로 바인딩(재생 실행은 tools.ts 가 sandbox 로 수행). 플래그 OFF 면 미노출.
        const procedural: ProceduralHooks | undefined = AGENT_TASK_LIMITS.PROCEDURAL_SKILLS_ENABLED
            ? {
                save: (i) => saveProceduralSkill(this.userId, i.name, i.description, {
                    kind: i.kind, goal: i.description, params: i.params,
                    actions: i.actions, allowlist: i.allowlist, lang: i.lang, code: i.code,
                }),
                load: (id) => resolveProceduralSpec(this.userId, id),
            }
            : undefined;
        // Computer Use Stage 0: browser 액션 계측을 taskId/userId 로 바인딩해 주입(fire-and-forget).
        const browserMetrics = AGENT_TASK_LIMITS.BROWSER_METRICS_ENABLED
            ? (stdout: string) => recordBrowserMetric(this.taskId, this.userId, stdout)
            : undefined;
        // 갭 C: 작업 스텝에서도 복수 전문가 토론(MoA)을 호출할 수 있게 한다.
        // orchestration-dispatch 는 AgentTaskService 를 import 하므로 정적 import 하면
        // 순환이 된다 — 호출 시점 동적 import 로 끊는다.
        // 전용 플래그(AGENT_TASK_DISCUSSION, 기본 OFF) — 작업 도구는 11종으로 고정 관리되며
        // 켜면 12종이 된다. 수요·도구폭주 근거는 config 주석 참고.
        const discuss = ORCHESTRATION_DISPATCH.TASK_DISCUSSION
            ? async (topic: string): Promise<string> => {
                const { runOrchestrationTool } = await import('../chat-service/orchestration-dispatch');
                return runOrchestrationTool({
                    name: 'start_discussion',
                    args: { topic },
                    userCtx: { userId: this.userId, role: 'user' },
                });
            }
            : undefined;
        this.defs = createTaskTools(this.executor, this.plan, delegate, spawn, procedural, browserMetrics, discuss);
        for (const d of this.defs) this.handlers.set(d.tool.name, d.handler);
    }

    /** 현재 실행 계획 스냅샷 (진행 가시성·영속용). */
    getPlanSnapshot(): PlanStep[] { return this.plan.snapshot(); }

    /** 관측/영속(sandboxContainerId)용 실행기 라벨 — docker: 컨테이너명, 원격(D1): 디바이스 라벨. */
    get containerName(): string { return this.executor.label; }

    /** 호스트 workspace 경로 or null(원격 실행기) — 호스트측 소비자(diff·git·영속)의 가드 기준. */
    get localWorkdir(): string | null { return this.executor.localWorkdir; }

    /** 호스트 workspace 절대경로 — 호스트측 git 연산(code-diff·clone·PR)이 의존.
     *  원격 실행기(D1)는 호스트 workspace 가 없으므로 호출부가 사용 전 가드해야 한다. */
    get workspacePath(): string {
        const p = this.executor.localWorkdir;
        if (p === null) throw new Error(`원격 실행기는 호스트 workspace 가 없습니다 (${this.taskId}) — localWorkdir 가드 필요`);
        return p;
    }

    async create(): Promise<void> { await this.executor.create(); }
    /** removeWorkspace=false 면 산출물 다운로드를 위해 workspace 보존(컨테이너만 제거). */
    async cleanup(removeWorkspace = true): Promise<void> { await this.executor.cleanup(removeWorkspace); }
    /** 산출물 회수용 — workspace 파일 목록(상대경로, 재귀). */
    async listWorkspace(): Promise<string[]> { return this.executor.listWorkspaceFiles(); }
    /** 입력 첨부 주입 등 호스트 측 workspace 파일 쓰기 — 경로 가드(safeRealWorkspacePath)+쿼터 적용. */
    async writeWorkspaceFile(relPath: string, content: string | Buffer): Promise<void> { return this.executor.writeFile(relPath, content); }

    /** 호스트 파일을 workspace 로 복사 — 대용량 입력 첨부의 스트리밍 주입(Buffer 미적재). */
    async importWorkspaceFile(relPath: string, srcAbsPath: string): Promise<void> { return this.executor.importFile(relPath, srcAbsPath); }

    /** 내부 검증용 원시 exec — 승인 게이트 우회(에이전트 도구 호출이 아닌 시스템 산출물 검증).
     *  컨테이너는 격리(network none·자원 캡)이고 문법/컴파일 검사는 코드를 실행하지 않아 안전. */
    async execRaw(command: string): Promise<ExecResult> { return this.executor.exec(command); }

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

        // ask_human 은 승인 정책·자동승인과 무관하게 항상 사용자 응답을 대기한다 — 도구의 목적
        // 자체가 HITL 이므로 승인 레지스트리(pause + push + REST approve/reject/answer)를 응답 채널로 사용.
        if (name === 'ask_human') {
            const question = String(args.question ?? '');
            const { decision, reason, text, waitedMs } = await getApprovalRegistry().request(
                { taskId: this.taskId, userId: this.userId, toolName: name, args },
                { timeoutMs: this.cfg.approvalTimeoutMs, signal: opts.signal, onPending: opts.onApprovalPending },
            );
            opts.onApprovalWaited?.(waitedMs);
            if (decision !== 'approved') {
                opts.onApprovalRejected?.({ toolName: name, reason: reason ?? 'user' });
                return reason === 'timeout'
                    ? `사용자가 응답하지 않았습니다(대기 시간 초과, 질문: ${question}). 사용자가 자리를 비운 것으로 보입니다 — 다시 질문하지 말고, 합리적인 가정을 명시한 뒤 지금까지 확보한 정보로 작업을 이어가거나 마무리하세요.`
                    : `사용자가 거절했거나 응답 시간이 초과되었습니다(질문: ${question}). 이 방향을 중단하고 대안을 시도하거나 terminate 로 마무리하세요.`;
            }
            // 자유텍스트 답변이 있으면 그대로 전달(에이전트가 실제 답을 받아 진행), 없으면 단순 승인.
            return text && text.trim()
                ? `사용자 답변(질문: ${question}): ${text.trim()}`
                : `사용자가 승인했습니다(계속 진행). 질문: ${question}`;
        }

        if (requiresApproval(this.cfg.approvalPolicy, name, args, { deviceGatesShell: this.cfg.deviceGatesShell })) {
            const { decision, reason, waitedMs } = await getApprovalRegistry().request(
                { taskId: this.taskId, userId: this.userId, toolName: name, args },
                { timeoutMs: this.cfg.approvalTimeoutMs, signal: opts.signal, onPending: opts.onApprovalPending },
            );
            opts.onApprovalWaited?.(waitedMs);
            if (decision !== 'approved') {
                opts.onApprovalRejected?.({ toolName: name, reason: reason ?? 'user' });
                return reason === 'timeout'
                    ? `Error: 승인 대기 시간이 초과되었습니다(무응답, ${name}). 사용자가 자리를 비운 것으로 보입니다 — 승인이 필요 없는 방법으로 진행하거나, 지금까지 확보한 결과로 최종 산출물을 작성하세요.`
                    : `Error: 사용자가 도구 실행을 승인하지 않았습니다 (${name}). 다른 방법을 시도하거나 작업을 종료하세요.`;
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
