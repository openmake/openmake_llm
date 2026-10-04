/**
 * 샌드박스를 쓰기로 한 작업이 샌드박스를 받지 못했을 때의 처리 — AgentTaskService 에서 분리(파일 크기 가드).
 *
 * 종전에는 생성이 실패하면 경고 로그 한 줄만 남기고 샌드박스 없이 진행했다. 모델은 실행 환경이 없다는 것을 모른 채
 * 검색만으로 답을 지어냈고, 그 답이 completed 로 기록됐다(2026-10-04 실측 — 평가를 여러 개 동시에 돌려 상한 8/8 에 걸린 실행들).
 *
 * 1. 동시 상한(TaskSandboxCapacityError)은 일시적이다 — 설정한 시간 동안 간격을 두고 다시 만든다. 취소 신호가 오면 바로 멈춘다.
 *    기다린 시간은 작업의 시간 예산에 그대로 든다(승인 대기처럼 빼 주지 않는다).
 * 2. 그래도 못 만들면 정책(TASK_SANDBOX_UNAVAILABLE_POLICY)대로 한다.
 *    - notify(기본): 스텝·진행 이벤트로 남기고, 모델에 안내하고, 완료 결과에 각주를 붙이고, 완료 판정에도 알린다.
 *    - fail: 스텝을 남기고 작업을 실패(sandbox_unavailable)로 끝낸다.
 *    - silent: 종전과 같다(대기도 하지 않는다).
 * 로컬 실행기(remote executor)는 대상이 아니다 — 종전과 같다.
 * 결정적 규칙이다(LLM 호출 없음).
 *
 * @module services/agent-task/sandbox-unavailable
 */
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { getSandboxUnavailableConfig } from '../../config/task-sandbox';
import {
    getSandboxWaitNote, getSandboxUnavailableStepNote, getSandboxUnavailableSystemNotice,
    getSandboxUnavailableFootnote, getSandboxUnavailableJudgeNote,
} from '../../prompts/agent-task-tools';
import { TaskSandboxCapacityError } from '../task-sandbox/sandbox';
import { AgentTaskAbort } from './types';
import { createLogger } from '../../utils/logger';
import type { ChatMessage } from '../../llm/types';

const logger = createLogger('AgentTaskService');

/** 실패 사유 코드(agent_tasks.error) — 정책 fail 일 때. 분류는 config/agent-task-failure-class. */
export const SANDBOX_UNAVAILABLE_ERROR = 'sandbox_unavailable';

/** 자리를 기다리다 포기했다 — 그동안 쓴 스텝 번호를 실어 처리부가 이어 쓰게 한다. */
class SandboxWaitExhausted extends Error {
    constructor(readonly cause: TaskSandboxCapacityError, readonly stepNumber: number) {
        super(cause.message);
        this.name = 'SandboxWaitExhausted';
    }
}

interface SandboxStepCtx {
    taskId: string;
    signal: AbortSignal;
    stepNumber: number;
    emitStep: (stepType: string, toolName?: string, content?: string | null) => void;
    /** 작업 대화 — [0] 이 system 이면 안내를 거기에 붙이고 뗀다. */
    conversation: ChatMessage[];
}

/** 실행 환경 없이 진행 중인 작업(notify) — 완료 관문이 각주·판정 맥락에 쓴다. 실행 종료 정리(run-cleanup)가 지운다. */
const unavailableTasks = new Set<string>();

export function clearSandboxUnavailable(taskId: string): void {
    unavailableTasks.delete(taskId);
}

/** 완료한 답변 뒤에 "실행 환경 없이 수행됨" 각주를 붙인다 — 해당 작업일 때만. */
export function withSandboxUnavailableFootnote(body: string, taskId: string): string {
    return unavailableTasks.has(taskId) ? `${body}\n\n${getSandboxUnavailableFootnote()}` : body;
}

/** 완료 판정의 수행 맥락(EXECUTION)에 실행 환경이 없었다는 줄을 붙인다 — 해당 작업일 때만. */
export function withSandboxUnavailableJudgeNote(execCtx: string, taskId: string): string {
    return unavailableTasks.has(taskId) ? `${execCtx}\n${getSandboxUnavailableJudgeNote()}` : execCtx;
}

/** 시간이 지나거나 취소 신호가 오면 풀린다. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done);
    });
}

/**
 * 샌드박스 생성 — 동시 상한에 걸리면 자리가 날 때까지 기다렸다 다시 만든다. 돌려주는 값은 다음 스텝 번호.
 * 상한이 아닌 실패는 그대로 던지고, 기다리다 포기하면 SandboxWaitExhausted, 취소되면 AgentTaskAbort 를 던진다.
 */
export async function createSandboxWaiting(runtime: { create(): Promise<void> }, p: SandboxStepCtx): Promise<number> {
    const cfg = getSandboxUnavailableConfig();
    const deadline = Date.now() + cfg.capacityWaitMs;
    let stepNumber = p.stepNumber;
    for (;;) {
        try {
            await runtime.create();
            break;
        } catch (e) {
            if (!(e instanceof TaskSandboxCapacityError) || cfg.policy === 'silent' || cfg.capacityWaitMs === 0) throw e;
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new SandboxWaitExhausted(e, stepNumber);
            if (stepNumber === p.stepNumber) {
                const note = getSandboxWaitNote(e.active, e.max, Math.ceil(cfg.capacityWaitMs / 1000));
                logger.info(`[AgentTask] ${note}: ${p.taskId}`);
                await getUnifiedDatabase().addAgentTaskStep({ taskId: p.taskId, stepNumber: stepNumber++, stepType: 'sandbox_wait', content: note });
                p.emitStep('sandbox_wait', undefined, note);
            }
            await sleep(Math.min(cfg.capacityWaitIntervalMs, remaining), p.signal);
            if (p.signal.aborted) throw new AgentTaskAbort('aborted');
        }
    }
    // 이전 실행(재개·fork)이 남긴 "실행 환경 없음" 안내는 이제 틀린 말이다.
    clearSandboxUnavailable(p.taskId);
    const system = p.conversation[0];
    if (system?.role === 'system' && typeof system.content === 'string') {
        system.content = system.content.replace(getSandboxUnavailableSystemNotice(), '');
    }
    return stepNumber;
}

/**
 * 샌드박스 준비 실패 처리 — 정책대로 남기고(또는 끝내고) 다음 스텝 번호를 돌려준다. 호출부는 런타임 없이 진행한다.
 * fail 정책이면 SANDBOX_UNAVAILABLE_ERROR 를 메시지로 던져 작업이 그 사유 코드로 실패하게 한다.
 */
export async function handleSandboxUnavailable(err: unknown, p: SandboxStepCtx & { remote?: boolean }): Promise<number> {
    const { policy } = getSandboxUnavailableConfig();
    logger.warn(`[AgentTask] 샌드박스 생성 실패 — ${policy === 'fail' && !p.remote ? '작업 실패 처리' : '미사용 진행'}: ${err instanceof Error ? err.message : err}`);
    if (p.remote || policy === 'silent') return p.stepNumber;
    if (p.signal.aborted) throw new AgentTaskAbort('aborted');

    const cause = err instanceof SandboxWaitExhausted ? err.cause : err;
    let stepNumber = err instanceof SandboxWaitExhausted ? err.stepNumber : p.stepNumber;
    const note = getSandboxUnavailableStepNote(
        cause instanceof TaskSandboxCapacityError ? { active: cause.active, max: cause.max } : undefined, policy === 'fail');
    await getUnifiedDatabase().addAgentTaskStep({ taskId: p.taskId, stepNumber: stepNumber++, stepType: 'sandbox_unavailable', content: note });
    p.emitStep('sandbox_unavailable', undefined, note);
    if (policy === 'fail') throw new Error(SANDBOX_UNAVAILABLE_ERROR);

    unavailableTasks.add(p.taskId);
    const system = p.conversation[0];
    const notice = getSandboxUnavailableSystemNotice();
    if (system?.role === 'system' && typeof system.content === 'string' && !system.content.includes(notice)) {
        system.content += notice;
    }
    return stepNumber;
}
