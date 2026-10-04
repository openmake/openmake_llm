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
import type { MCPToolDefinition } from '../../tool-contract/types';
import { getTaskSandboxConfig, type TaskSandboxConfig } from '../../config/task-sandbox';
import { TaskSandbox, type ExecResult } from './sandbox';
import type { TaskExecutor } from './executor';
import { createTaskTools, type DelegateFn, type SpawnFn, type ProceduralHooks } from './tools';
import { recordBrowserMetric } from './browser-metrics';
import { AGENT_TASK_LIMITS, MAX_TOOL_RESULT_CHARS, TOOL_RESULT_TRUNCATION } from '../../config/runtime-limits';
import { truncateToolResult } from '../agent-task/tool-result-truncate';
import { spillToolResult } from '../agent-task/tool-result-spill';
import { recordToolResultTruncation } from '../tool-result-truncation-recorder';
import { bindSkillRunApproval } from './skill-run-binding';
import { normalizeAskHuman } from './ask-human';
import { createTaskHistoryTools } from '../agent-task/task-history-tool';
import { createMemorySaveTools } from '../agent-task/memory-save-tool';
import { saveProceduralSkill, revertProceduralSkill, resolveProceduralSpec, recordProceduralRun } from '../agent-task/procedural-skill';
import { TaskPlan, parseGoalPlanSteps, type PlanStep } from './planning';
import { requiresApproval, getApprovalRegistry, type PendingApproval, type ApprovalRejectReason } from './approval-gate';
import { withToolNameSuggestions, detectShellToolMisuse, formatShellToolMisuseHint } from '../../tool-contract/tool-name-suggest';
import { buildApprovalPreview } from './approval-preview';
import type { PlanStepInput } from './planning';
import type { ContributedAgentTaskTool } from '../chat-service/turn-integrations';
import { APPROVAL_PREVIEW } from '../../config/task-sandbox';
import { createLogger } from '../../utils/logger';
import { AgentTaskParked } from '../agent-task/types';
import { getApprovalRejectedNotice } from '../../prompts/agent-task-approval';

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

export function resultToString(r: { content: Array<{ text?: string }>; isError?: boolean }, cap = MAX_TOOL_RESULT_CHARS): string {
    // NUL(0x00) 제거 — 바이너리 파일을 도구로 열람하면 결과에 0x00 이 섞일 수 있고, 이는 모델
    // 컨텍스트/스텝 저장(Postgres TEXT·JSON)으로 흘러가면 "invalid byte sequence" 로 태스크를 깨뜨린다.
    // 상한을 넘으면 앞·뒤를 남긴다 — 셸 결과의 stderr·종료 코드 줄은 끝에 있다(tool-result-truncate).
    const text = truncateToolResult(
        r.content.map((c) => c.text ?? '').join('\n').replace(/\u0000/g, ''), cap, TOOL_RESULT_TRUNCATION.HEAD_RATIO,
    );
    return r.isError ? `Error: ${text}` : text;
}

interface ExecuteTaskToolOpts {
    signal?: AbortSignal;
    /** 승인 대기 진입 시 호출 — 호출부가 status='paused' + web-push/WS 발행. */
    onApprovalPending?: (p: PendingApproval) => void;
    /** 승인 대기 종료 시 대기시간(ms) 통지 — pause-aware 타임아웃(4-1)이 총 예산에서 제외. */
    onApprovalWaited?: (ms: number) => void;
    /** 승인 거절 시 사유 통지 — 호출부가 무응답('timeout') 연속 횟수를 세어 HITL 강등 판단. */
    onApprovalRejected?: (info: { toolName: string; reason: ApprovalRejectReason }) => void;
    /** 승인을 통과해 핸들러를 부르기 직전 — 호출부가 실행 중 표식(172)을 남긴다. */
    onBeforeExecute?: () => Promise<void>;
}

export class TaskRuntime {
    readonly taskId: string;
    readonly userId: string;
    private readonly cfg: TaskSandboxConfig;
    private readonly executor: TaskExecutor;
    private readonly plan = new TaskPlan({ autoAdvance: AGENT_TASK_LIMITS.PLAN_AUTO_ADVANCE });
    private readonly handlers = new Map<string, MCPToolDefinition['handler']>();
    private readonly defs: MCPToolDefinition[];
    /** 기여 도구의 승인 전 검사 — 실행해도 거절될 호출은 승인 카드를 띄우지 않고 돌려준다(memory_save 의 문장 검사). */
    private readonly prechecks = new Map<string, NonNullable<ContributedAgentTaskTool['precheck']>>();
    /** 절차 스킬 조회 — skill_run 승인 결속(skill-run-binding)이 승인 전에 절차를 불러올 때 쓴다. 플래그 OFF 면 없음. */
    private readonly loadProcedure?: ProceduralHooks['load'];
    /** 이 작업에 실제로 노출된 도구 이름(task + MCP + 내장). 이름 교정·셸 오용 감지에만 쓴다. */
    private knownToolNames: string[] = [];

    constructor(
        taskId: string,
        userId: string,
        cfg: TaskSandboxConfig = getTaskSandboxConfig(),
        delegate?: DelegateFn,
        spawn?: SpawnFn,
        /** 실행 백엔드 주입(D1 원격 실행기용). 미지정 시 현행 Docker 샌드박스. */
        executor?: TaskExecutor,
        /** 작업 목표 — 번호 절차가 있으면 초기 계획으로 심는다(아래 seedPlanFromGoal). */
        goal?: string,
    ) {
        this.taskId = taskId;
        this.userId = userId;
        this.cfg = cfg;
        this.executor = executor ?? new TaskSandbox(taskId, cfg);
        this.seedPlanFromGoal(goal);
        // #1 절차 스킬: 저장/조회 훅을 userId 로 바인딩(재생 실행은 tools.ts 가 sandbox 로 수행). 플래그 OFF 면 미노출.
        const procedural: ProceduralHooks | undefined = AGENT_TASK_LIMITS.PROCEDURAL_SKILLS_ENABLED
            ? {
                save: (i) => saveProceduralSkill(this.userId, i.name, i.description, {
                    kind: i.kind, goal: i.description, params: i.params,
                    actions: i.actions, allowlist: i.allowlist, lang: i.lang, code: i.code,
                }, { update: i.update }),
                revert: (name) => revertProceduralSkill(this.userId, name),
                load: (id) => resolveProceduralSpec(this.userId, id),
                recordRun: (run) => recordProceduralRun(this.userId, run),
            }
            : undefined;
        this.loadProcedure = procedural?.load;
        // Computer Use Stage 0: browser 액션 계측을 taskId/userId 로 바인딩해 주입(fire-and-forget).
        const browserMetrics = AGENT_TASK_LIMITS.BROWSER_METRICS_ENABLED
            ? (stdout: string) => recordBrowserMetric(this.taskId, this.userId, stdout)
            : undefined;
        // 갭 C: add-on 이 기여한 작업 도구(예: 복수 전문가 토론). 노출 여부(플래그)는 add-on 이 판단한다 —
        // 작업 도구는 고정 관리되며 기여분만큼 늘어난다. 통합 모듈은 AgentTaskService 를 끌어올 수 있어
        // 정적 import 하면 순환이 된다 — 생성 시점 require 로 끊는다.
        const { getChatTurnIntegrations } = require('../chat-service/turn-integrations') as typeof import('../chat-service/turn-integrations');
        const contributed = [
            ...getChatTurnIntegrations().flatMap((i) => i.agentTaskTools?.() ?? []),
            ...createTaskHistoryTools(taskId, goal ? { goal } : {}), ...createMemorySaveTools(taskId, goal ? { goal } : {}),
        ];
        for (const c of contributed) if (c.precheck) this.prechecks.set(c.tool.name, c.precheck);
        this.defs = createTaskTools(this.executor, this.plan, delegate, spawn, procedural, browserMetrics, contributed, { userId: this.userId });
        for (const d of this.defs) this.handlers.set(d.tool.name, d.handler);
    }

    /** 현재 실행 계획 스냅샷 (진행 가시성·영속용). */
    getPlanSnapshot(): PlanStep[] { return this.plan.snapshot(); }

    /** 재개 시 체크포인트의 계획 복원(124) — goal 시드 계획을 저장본으로 교체한다. */
    restorePlan(steps: unknown): void { this.plan.restore(steps); }
    /** 사용자 편집(139) — 같은 텍스트의 단계는 상태를 보존(TaskPlan.create 규칙). */
    replacePlan(steps: PlanStepInput[]): void { this.plan.create(steps); }
    renderPlan(): string { return this.plan.render(); }

    /** 관측/영속(sandboxContainerId)용 실행기 라벨 — docker: 컨테이너명, 원격(D1): 디바이스 라벨. */
    get containerName(): string { return this.executor.label; }

    /** 호스트 workspace 경로 or null(원격 실행기) — 호스트측 소비자(diff·git·영속)의 가드 기준. */
    get localWorkdir(): string | null { return this.executor.localWorkdir; }

    /**
     * 상한을 넘는 도구 결과를 작업 공간 파일로 보관하고 미리보기 + 경로 안내를 돌려준다(tool-result-spill, 기본 꺼짐).
     * 서버 샌드박스에서만 — 로컬 실행기의 작업 공간은 사용자 폴더라 쓰지 않는다. 보관하지 않았으면 null(호출부가 종전 절단).
     */
    readonly spillLargeResult = (toolName: string, raw: string): Promise<string | null> => spillToolResult(toolName, raw, {
        cap: MAX_TOOL_RESULT_CHARS, headRatio: TOOL_RESULT_TRUNCATION.HEAD_RATIO,
        target: this.executor.localWorkdir !== null ? this.executor : null,
    });

    /** 실행기 자체 diff(로컬 worktree). 미지원이면 null → 호출부가 workspace git 캡처로 폴백. */
    async captureExecutorDiff(): Promise<string | null> {
        return this.executor.captureDiff ? this.executor.captureDiff() : null;
    }

    /** 실행기 전용 테스트 러너 탐지(로컬 브리지 — 디바이스 확인 창 없이). 'none' 은 러너 없음, null 은 미지원·실패 → 호출부가 셸 프로브로 폴백. */
    async detectTestRunnerNative(): Promise<string | null> {
        return this.executor.detectTestRunner ? this.executor.detectTestRunner() : null;
    }

    /** 승인 대기 알림을 실행기 채널로(로컬 브리지 → 디바이스 네이티브 알림). 미지원 실행기(docker)는 no-op. */
    notifyApprovalPending(toolName: string): void { this.executor.notifyApprovalPending?.(toolName); }

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

    /** 시스템 임시 파일(검증 프로브 등) 정리 — 로컬 실행기에선 workspace 가 사용자 폴더다. */
    async deleteWorkspaceFile(relPath: string): Promise<void> { return this.executor.deleteFile(relPath); }

    /** 호스트 파일을 workspace 로 복사 — 대용량 입력 첨부의 스트리밍 주입(Buffer 미적재). */
    async importWorkspaceFile(relPath: string, srcAbsPath: string): Promise<void> { return this.executor.importFile(relPath, srcAbsPath); }

    /** 내부 검증용 원시 exec — 승인 게이트 우회(에이전트 도구 호출이 아닌 시스템 산출물 검증).
     *  컨테이너는 격리(network none·자원 캡)이고 문법/컴파일 검사는 코드를 실행하지 않아 안전. */
    async execRaw(command: string): Promise<ExecResult> { return this.executor.exec(command); }

    /**
     * goal 의 번호 절차를 초기 계획으로 심는다.
     *
     * 모델은 goal 에 적힌 `1) … 7)` 을 계획으로 인식해 plan_create 없이 plan_update(step:N)
     * 부터 부른다 — 그때 TaskPlan 이 비어 있으면 "계획이 없습니다"/"범위를 벗어났습니다" 로
     * 턴을 버린다(실측 28건 중 20건). 번호를 미리 심어 두 번호 체계를 일치시킨다.
     * 절차가 없는 goal 엔 no-op 이고, 모델이 plan_create 를 부르면 기존 상태 보존 병합이 받는다.
     */
    private seedPlanFromGoal(goal?: string): void {
        if (!AGENT_TASK_LIMITS.PLAN_FROM_GOAL || !goal) return;
        const steps = parseGoalPlanSteps(goal, {
            minItems: AGENT_TASK_LIMITS.PLAN_FROM_GOAL_MIN_ITEMS,
            maxItems: AGENT_TASK_LIMITS.PLAN_FROM_GOAL_MAX_ITEMS,
            maxTextChars: AGENT_TASK_LIMITS.PLAN_FROM_GOAL_MAX_TEXT_CHARS,
        });
        if (steps.length === 0) return;
        this.plan.create(steps);
        logger.info(`[${this.taskId}] goal 절차 ${steps.length}단계를 초기 계획으로 심음`);
    }

    /** task-scoped 도구를 LLM 형식으로. AgentTaskService 가 effectiveTools 에 합류. */
    getLLMTools(): ToolDefinition[] { return this.defs.map(toLLMTool); }

    isTaskTool(name: string): boolean { return this.handlers.has(name); }

    /**
     * 모델에 실제로 노출된 전체 도구 이름을 알려준다(AgentTaskService 가 도구 목록 확정 후 1회).
     * task 도구만으로는 `web_search` 처럼 MCP·내장 도구를 셸에서 부른 경우를 알아볼 수 없다.
     */
    setKnownToolNames(names: readonly string[]): void {
        this.knownToolNames = Array.from(new Set([...this.handlers.keys(), ...names]));
    }


    /**
     * 셸 출력에 "도구 이름을 명령으로 실행" 한 흔적이 있으면 결과 끝에 교정 안내를 덧붙인다.
     * 실측(30일 5건): 모델이 `web_search "질의"` 를 bash 로 실행해 `not found` 만 보고 헤맸다.
     */
    private appendShellToolHint(toolName: string, output: string): string {
        if (toolName !== 'bash') return output;
        const known = this.knownToolNames.length > 0 ? this.knownToolNames : Array.from(this.handlers.keys());
        const misused = detectShellToolMisuse(output, known);
        return misused.length > 0 ? output + formatShellToolMisuseHint(misused) : output;
    }
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
        if (!handler) {
            const known = this.knownToolNames.length > 0 ? this.knownToolNames : Array.from(this.handlers.keys());
            return withToolNameSuggestions(`Error: 알 수 없는 task 도구 ${name}`, name, known);
        }

        // ask_human 은 승인 정책·자동승인과 무관하게 항상 사용자 응답을 대기한다 — 도구의 목적
        // 자체가 HITL 이므로 승인 레지스트리(pause + push + REST approve/reject/answer)를 응답 채널로 사용.
        if (name === 'ask_human') {
            // 질문 여러 개·선택지는 구조로 싣고, 구조를 모르는 클라이언트용으로 줄글 question 도 함께 싣는다(ask-human).
            const asked = normalizeAskHuman(args);
            const question = asked.question;
            const { decision, reason, text, waitedMs } = await getApprovalRegistry().request(
                { taskId: this.taskId, userId: this.userId, toolName: name, args: asked },
                { timeoutMs: this.cfg.approvalTimeoutMs, signal: opts.signal, onPending: opts.onApprovalPending, parkable: true },
            );
            opts.onApprovalWaited?.(waitedMs);
            if (reason === 'parked') throw new AgentTaskParked(); // 만료 → 주차(F16.7): 답이 오면 같은 호출로 재개
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

        const refusal = await this.prechecks.get(name)?.(args, { userId: this.userId });
        if (refusal) return `Error: ${refusal}`;

        // skill_run — 승인 전에 절차를 불러 인자에 체크섬을 묶는다. 승인 카드에는 절차 본문을 싣고, 실행 단계가 같은 절차인지 확인한다.
        const skillPreview = name === 'skill_run' && this.loadProcedure ? await bindSkillRunApproval(args, this.loadProcedure) : null;
        if (requiresApproval(this.cfg.approvalPolicy, name, args, { deviceGatesShell: this.cfg.deviceGatesShell })) {
            // 실행 전 미리보기(138) — 파일 쓰기 도구는 현재 파일과 인자로 diff 를 만들어 승인 카드에 싣는다(fail-open)
            const preview = skillPreview ?? (APPROVAL_PREVIEW.ENABLED
                ? await buildApprovalPreview(name, args, (p) => this.executor.readFile(p)).catch(() => null)
                : null);
            const { decision, reason, text: rejectText, waitedMs } = await getApprovalRegistry().request(
                { taskId: this.taskId, userId: this.userId, toolName: name, args, preview: preview ?? undefined },
                { timeoutMs: this.cfg.approvalTimeoutMs, signal: opts.signal, onPending: opts.onApprovalPending, parkable: true, policy: this.cfg.approvalPolicy },
            );
            opts.onApprovalWaited?.(waitedMs);
            if (reason === 'parked') throw new AgentTaskParked(); // 유예 초과 → 주차: 결정이 오면 같은 호출로 재개(실행 전이라 부작용 없음)
            if (decision !== 'approved') {
                opts.onApprovalRejected?.({ toolName: name, reason: reason ?? 'user' });
                return getApprovalRejectedNotice(name, reason, rejectText);
            }
        }

        // 작업 취소 → 실행 중인 샌드박스 명령 중단(도구 핸들러는 signal 을 받지 않는다).
        const onAbort = (): void => this.executor.abortRunning?.();
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        try {
            await opts.onBeforeExecute?.();
            const r = await handler(args, { userId: this.userId, role: 'user' });
            const typed = r as { content: Array<{ text?: string }>; isError?: boolean };
            // G3 셰도우 계측 — task 도구는 turn-executor 의 runTool 을 타지 않아(이 경로가 캡 지점)
            // 여기서 적재한다 (2026-08-08 라이브 점검에서 발견된 계측 사각).
            recordToolResultTruncation({
                path: 'agent_task', toolName: name,
                rawChars: typed.content.map((c) => c.text ?? '').join('\n').length,
                capChars: MAX_TOOL_RESULT_CHARS,
            });
            const spilled = await this.spillLargeResult(name, resultToString(typed, Number.MAX_SAFE_INTEGER));
            return this.appendShellToolHint(name, spilled ?? resultToString(typed));
        } catch (e) {
            if (e instanceof AgentTaskParked) throw e; // delegate 안의 승인 주차(173) — 오류 결과로 삼키지 않는다
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`[${this.taskId}] task 도구 실행 실패 (${name}): ${msg}`);
            return `Error: ${msg}`;
        } finally {
            opts.signal?.removeEventListener('abort', onAbort);
        }
    }
}
