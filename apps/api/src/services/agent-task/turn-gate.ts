/**
 * Agent Task 턴 자원 가드 — AgentTaskService 에서 분리 (파일 크기 가드).
 *
 * 턴 시작 시 자원 상태(검색/브라우저 호출 수·토큰 예산·남은 턴·승인 무응답)를 판정해
 * 이 턴에 노출할 도구 세트를 깎고, 각 가드의 최초 발동 시 1회 nudge 주입 + 스텝 기록을
 * 수행한다. 프롬프트 지시를 모델이 무시해도 도구 자체가 사라지므로 폭주가 끊긴다.
 *
 * @module services/agent-task/turn-gate
 */
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { getAgentTaskBrowserLimitNudge, getAgentTaskFinalTurnNudge, getAgentTaskApprovalTimeoutNudge } from '../../prompts/agent-task-prompt';
import { stripApprovalGatedTools } from '../task-sandbox/approval-gate';
import { isSearchTool } from './task-steps';
import { createLogger } from '../../utils/logger';
import type { ChatMessage, ToolDefinition } from '../../llm/types';
import type { TaskSandboxConfig } from '../../config/task-sandbox';

const logger = createLogger('AgentTaskService');

export type FinalTurnReason = 'turns' | 'tokens' | null;

/** 가드별 "1회 nudge 주입" 플래그 — 턴 루프가 소유하고 이 모듈이 제자리 갱신한다. */
export interface TurnGateFlags {
    searchLimitNotified: boolean;
    browserLimitNotified: boolean;
    finalTurnNotified: boolean;
    approvalDegradeNotified: boolean;
}

export interface TurnGateInput {
    taskId: string;
    turn: number;
    startTurn: number;
    turnCeiling: number;
    totalTokens: number;
    searchCalls: number;
    browserCalls: number;
    /** 승인 무응답(timeout) 누적 — HITL 강등 판정(명시 거절은 카운트 제외). */
    approvalTimeouts: number;
    tools: ToolDefinition[];
    sandboxCfg: TaskSandboxConfig;
    /** nudge 주입 대상 — 제자리 갱신. */
    conversation: ChatMessage[];
    /** 제자리 갱신. */
    flags: TurnGateFlags;
    stepNumber: number;
    emitStep: (stepType: string, toolName?: string, content?: string | null) => void;
}

export interface TurnGateResult {
    effectiveTools: ToolDefinition[];
    /** 마무리 턴 전환 사유 — 호출부의 "마무리 턴 도구 차단" 가드가 이어서 사용. */
    finalTurnReason: FinalTurnReason;
    stepNumber: number;
}

/**
 * 턴 자원 가드 일괄 적용. 각 가드의 근거·순서는 다음과 같다.
 *
 * - 마무리 턴: 자원 상한에 **닿기 전에** 도구를 전부 끊어 종합 답변을 받는다. 상한에서 그냥
 *   끊으면 산출물을 이미 만든 작업도 사족에서 절단돼 결과가 남지 않는다(2026-08-03: 예약
 *   리포트 20/20 3건 중 2건이 리포트 생성 후 검증 사족에서 절단). 턴 사유는 도구를 쓸 턴이
 *   최소 하나 있었을 때만 건다 — maxTurns=1 이면 유일한 턴이 곧 마지막이라 조건 없이 걸면
 *   도구를 한 번도 못 쓴다. 토큰 사유엔 이 가드가 없다: 누적이 임계를 넘었다는 건 resume 으로
 *   이미 예산을 소진하고 들어왔다는 뜻이라 첫 턴부터 마무리로 보내는 것이 맞다.
 * - 검색/브라우저 cap: browser 는 SEARCH_TOOL_KEYWORDS 에 안 잡혀 검색 throttle 로 제어
 *   불가하므로 별도 cap.
 * - HITL 무응답 강등: 승인 timeout 이 임계에 달하면 승인 필요 도구를 제거해 대기-소진 반복
 *   대신 확보한 정보로 마무리를 강제한다(명시 거절은 카운트 안 함).
 *
 * nudge 발동은 스텝으로 남긴다 — ① 사용자에겐 "왜 도구가 갑자기 멈췄는지"의 설명이 되고
 * ② 발동 빈도·사유를 DB 로 집계할 수 있다(로그만으론 재기동 시 유실). 기록 실패는 fail-open.
 */
export async function applyTurnResourceGates(p: TurnGateInput): Promise<TurnGateResult> {
    const { taskId, turn, turnCeiling, totalTokens, conversation, flags, emitStep } = p;
    const db = getUnifiedDatabase();
    let stepNumber = p.stepNumber;

    const overSearchLimit = p.searchCalls >= AGENT_TASK_LIMITS.MAX_SEARCH_CALLS;
    const overBrowserLimit = p.browserCalls >= AGENT_TASK_LIMITS.MAX_BROWSER_CALLS;
    const hitlDegraded = AGENT_TASK_LIMITS.HITL_TIMEOUT_DEGRADE_AFTER > 0
        && p.approvalTimeouts >= AGENT_TASK_LIMITS.HITL_TIMEOUT_DEGRADE_AFTER;
    const finalTurnReason: FinalTurnReason = !AGENT_TASK_LIMITS.FINAL_TURN_NUDGE_ENABLED
        ? null
        : totalTokens >= AGENT_TASK_LIMITS.MAX_TOTAL_TOKENS * AGENT_TASK_LIMITS.TOKEN_SOFT_RATIO
            ? 'tokens'
            : (turn > p.startTurn && turn === turnCeiling - 1)
                ? 'turns'
                : null;

    const cappedTools = finalTurnReason
        ? []
        : (overSearchLimit || overBrowserLimit)
            ? p.tools.filter((t) => {
                const n = t.function.name;
                if (overSearchLimit && isSearchTool(n)) return false;
                if (overBrowserLimit && n === 'browser') return false;
                return true;
            })
            : p.tools;
    const effectiveTools = hitlDegraded
        ? stripApprovalGatedTools(cappedTools, p.sandboxCfg.approvalPolicy,
            { deviceGatesShell: p.sandboxCfg.deviceGatesShell })
        : cappedTools;

    if (finalTurnReason && !flags.finalTurnNotified) {
        conversation.push({ role: 'user', content: getAgentTaskFinalTurnNudge(finalTurnReason) });
        flags.finalTurnNotified = true;
        const note = `자원 상한 임박(${finalTurnReason === 'tokens' ? '토큰 예산' : '남은 턴'})`
            + ` — 도구를 중단하고 최종 정리로 전환 (턴 ${turn + 1}/${turnCeiling}, 누적 ${totalTokens} 토큰)`;
        await db.addAgentTaskStep({ taskId, stepNumber: stepNumber++, stepType: 'final_turn', content: note })
            .catch(() => { /* 관측 실패가 작업을 죽이지 않게 fail-open */ });
        emitStep('final_turn', undefined, note);
        logger.info(`[AgentTask] 마무리 턴 전환: ${taskId} (사유=${finalTurnReason}, `
            + `턴 ${turn + 1}/${turnCeiling}, 누적 ${totalTokens} 토큰)`);
    }
    if (hitlDegraded && !flags.approvalDegradeNotified) {
        conversation.push({ role: 'user', content: getAgentTaskApprovalTimeoutNudge() });
        flags.approvalDegradeNotified = true;
        const note = `승인 무응답 ${p.approvalTimeouts}회 — 승인 필요 도구를 제거하고 확보한 정보로 마무리 전환 (턴 ${turn + 1}/${turnCeiling})`;
        await db.addAgentTaskStep({ taskId, stepNumber: stepNumber++, stepType: 'hitl_degrade', content: note })
            .catch(() => { /* 관측 실패가 작업을 죽이지 않게 fail-open */ });
        emitStep('hitl_degrade', undefined, note);
        logger.info(`[AgentTask] HITL 무응답 강등: ${taskId} (timeouts=${p.approvalTimeouts}, 턴 ${turn + 1})`);
    }
    if (overSearchLimit && !flags.searchLimitNotified) {
        conversation.push({
            role: 'user',
            content: '검색 횟수 한도에 도달했습니다. 더 이상 검색하지 말고, 지금까지 수집한 정보만으로 최종 결과물(예: 블로그 초안)을 완성해 작성하세요.',
        });
        flags.searchLimitNotified = true;
    }
    if (overBrowserLimit && !flags.browserLimitNotified) {
        conversation.push({ role: 'user', content: getAgentTaskBrowserLimitNudge() });
        flags.browserLimitNotified = true;
    }

    return { effectiveTools, finalTurnReason, stepNumber };
}
