/**
 * 턴 응답 처리 — 모델 응답의 도구 호출 정리(마무리 턴 차단·텍스트 도구 호출 승격·id 정리), 빈 응답 되묻기, 응답 스텝 기록.
 * AgentTaskService 에서 그대로 옮겼다 — 서비스 파일의 줄 수(600줄 가드)를 지키기 위해 분리. 로그는 서비스와 같은 이름으로 남긴다.
 *
 * @module services/agent-task/turn-response
 */
import type { ChatMessage, ToolCall } from '../../llm/types';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { getAgentTaskEmptyResponseNudge, AGENT_TASK_EMPTY_RESPONSE_PLACEHOLDER } from '../../prompts/agent-task-prompt';
import { getThinkingDowngradeNote } from '../../prompts/agent-task-turn-loop';
import { extractAndStripArtifacts } from '../../llm/artifact-parser';
import { applyReportRender } from '../chat-service/report-block';
import { createLogger } from '../../utils/logger';
import { shouldAdoptFinalTurnAnswer } from './turn-gate';
import { recoverTextToolCalls } from './text-tool-calls';
import { ensureUniqueToolCallIds } from './turn-reentry';
import { replyNudge } from './one-shot-notice';
import { noteThinkingFailure } from './thinking-downgrade';
import { prepareToolArgs } from './tool-args';
import { runStateOf, type AgentRoleState } from './role-client';

const logger = createLogger('AgentTaskService');

type TurnResult = { content: string; tool_calls?: ToolCall[] };
type EmitStep = (stepType: string, toolName?: string, content?: string | null) => void;

/**
 * 도구 호출 정리 — 마무리 턴의 도구 호출 무시·본문 채택, 텍스트 도구 호출 승격, tool_call id 중복 정리. result 를 제자리 갱신한다.
 * skip=true 면 호출부가 이 턴을 끝낸다(continue).
 */
export async function normalizeTurnToolCalls(p: {
    result: TurnResult; finalTurnReason: unknown; taskId: string; turn: number; conversation: ChatMessage[]; stepNumber: number; emitStep: EmitStep;
}): Promise<{ skip: boolean; stepNumber: number }> {
    const { result, finalTurnReason, taskId, turn, conversation, emitStep } = p;
    let stepNumber = p.stepNumber;
    const db = getUnifiedDatabase();
    // 마무리 턴(도구 차단): effectiveTools=[] 로 호출했어도 모델이 native tool_calls 를
    // 뱉거나 XML 텍스트로 도구를 호출(아래 recoverTextToolCalls 가 승격)하면 도구가 실행돼
    // 최종 정리가 무산된다. finalTurnReason 이면 그 호출을 실행하지 않는다 — 남은 턴이
    // 있으면(토큰 사유) 도구 없는 다음 턴에서 답변을 유도하고, 마지막 턴이면 도구 없이 끝나
    // turn 상한 종료(재개 가능)로 떨어진다(도구만 부른 응답을 "완료"로 오표시하지 않음).
    // tool_calls 는 남기지 않는다 — tool 결과 없이 dangling 되면 resume/렌더 정합이 깨진다.
    const finalTurnHasNativeTools = !!(result.tool_calls && result.tool_calls.length > 0);
    const finalTurnHasTextTools = !!finalTurnReason && !finalTurnHasNativeTools
        && !!result.content && recoverTextToolCalls(result.content).length > 0;
    // 실질 답변 채택: 도구 호출이 섞였어도 본문이 충분하면 그 텍스트를 최종 답변으로 삼는다.
    // 종전엔 응답 전체를 버려서, 산출물을 다 만들어 놓고 마지막 턴에 도구를 한 번 더 부르려 한
    // 작업이 max_turns_exhausted 로 실패 기록됐다(2026-08-08 예약 리포트: 렌더 완료된 36KB
    // report.html 이 게시되지 못하고 workspace 와 함께 폐기). 텍스트 도구 호출(XML) 케이스는
    // 본문 자체가 도구 호출문이라 채택하지 않는다 — native tool_calls 만 버리고 본문을 살린다.
    const finalTurnAnswerLen = (result.content ?? '').trim().length;
    const finalTurnAnswerUsable = shouldAdoptFinalTurnAnswer({
        finalTurn: !!finalTurnReason,
        hasNativeTools: finalTurnHasNativeTools,
        hasTextTools: finalTurnHasTextTools,
        answerLength: finalTurnAnswerLen,
    });
    if (finalTurnReason && (finalTurnHasNativeTools || finalTurnHasTextTools) && !finalTurnAnswerUsable) {
        logger.info(`[AgentTask] 마무리 턴 도구 호출 무시: ${taskId} (turn ${turn + 1})`);
        conversation.push({ role: 'assistant', content: result.content });
        const stType = turn === 0 ? 'plan' : 'assistant';
        await db.addAgentTaskStep({ taskId, stepNumber: stepNumber++, stepType: stType, content: result.content });
        emitStep(stType, undefined, result.content);
        return { skip: true, stepNumber };
    }
    if (finalTurnAnswerUsable) {
        // 도구 호출만 떨궈 아래 최종 답변 경로(finalize 관문)로 자연 진입시킨다.
        logger.info(`[AgentTask] 마무리 턴 도구 호출 폐기·본문 채택: ${taskId} `
            + `(turn ${turn + 1}, ${finalTurnAnswerLen}자, 폐기 ${result.tool_calls!.length}건)`);
        result.tool_calls = undefined;
    }

    // qwen 결함 보정: 구조화 tool_calls 없이 도구 호출을 XML 텍스트로 뱉으면 실행이 안 돼
    // 파일이 안 만들어진다(→ 다운로드할 산출물 없음) — 파싱해 실 tool_calls 로 승격 후 실행.
    // 마무리 턴은 위 도구 차단 가드에서 이미 continue 로 처리되므로 여기 도달하지 않는다.
    // 대화 기록 **전에** 승격해야 assistant.tool_calls 에 남아 tool 결과와 짝이 맞고 턴 중간 재개가 된다.
    if ((!result.tool_calls || result.tool_calls.length === 0) && result.content) {
        const recovered = recoverTextToolCalls(result.content);
        if (recovered.length > 0) { result.tool_calls = recovered; result.content = ''; }
    }
    if (result.tool_calls?.length) result.tool_calls = ensureUniqueToolCallIds(result.tool_calls, conversation, turn);
    return { skip: false, stepNumber };
}

/** 빈 응답 되묻기 — 추론 강등 스텝(해당 시)·자리표시 응답·되묻기·retry 스텝을 남긴다. 반환은 다음 stepNumber. */
export async function nudgeEmptyResponse(p: {
    roleState: AgentRoleState; conversation: ChatMessage[]; taskId: string; stepNumber: number; emptyRetries: number; planIdx: () => number | undefined;
}): Promise<number> {
    const { roleState, conversation, taskId, emptyRetries, planIdx } = p;
    let stepNumber = p.stepNumber;
    const db = getUnifiedDatabase();
    // 추론을 켠 작업의 빈 응답도 연속 실패로 센다(184) — 임계면 이번 실행만 추론을 끈다.
    if (noteThinkingFailure(runStateOf(roleState))) {
        await db.addAgentTaskStep({ taskId, stepNumber: stepNumber++, stepType: 'thinking_downgrade',
            content: getThinkingDowngradeNote(roleState.thinkingLevel ?? 'off', roleState.thinkingFailures ?? 0), planStepIndex: planIdx() });
    }
    conversation.push({ role: 'assistant', content: AGENT_TASK_EMPTY_RESPONSE_PLACEHOLDER }, replyNudge(getAgentTaskEmptyResponseNudge()));
    await db.addAgentTaskStep({ taskId, stepNumber: stepNumber++, stepType: 'retry', content: `빈 응답 — 되묻기 ${emptyRetries}/${AGENT_TASK_LIMITS.EMPTY_RESPONSE_MAX_RETRIES}`, planStepIndex: planIdx() });
    return stepNumber;
}

/** 응답 스텝 기록 — 최종 답변 턴이면 아티팩트를 떼어 낸 본문을 기록한다. 반환: 도구 호출 여부·추출 결과·기록 본문·다음 stepNumber. */
export async function recordResponseStep(p: {
    result: TurnResult; turn: number; taskId: string; stepNumber: number; planIdx: () => number | undefined; emitStep: EmitStep;
}): Promise<{ hasToolCalls: boolean; extracted: ReturnType<typeof extractAndStripArtifacts> | null; stepContent: string; stepNumber: number }> {
    const { result, turn, taskId, planIdx, emitStep } = p;
    let stepNumber = p.stepNumber;
    const db = getUnifiedDatabase();
    const hasToolCalls = !!result.tool_calls && result.tool_calls.length > 0;

    // 최종 답변 턴이면 deliverable(<artifact> 태그) 추출 — 스텝/result 는
    // cleaned 본문으로 기록하고, 아티팩트는 step_type='artifact' 행으로 영속화.
    // reportdata 블록은 추출 **전에** 고정 템플릿으로 렌더해 <artifact> 로 변환
    // (P1 Phase 2 — 렌더 없인 fence-fallback 이 원본 JSON 을 code 아티팩트로 오영속).
    const extracted = hasToolCalls ? null : extractAndStripArtifacts(applyReportRender(result.content ?? ''));
    const stepContent = extracted ? extracted.cleanedContent : result.content;

    // 스텝 기록(display용). 첫 턴은 목표 분해 계획(plan)으로 표시.
    // resume 복원 상태(turn>0)는 plan 이 아님 — 중간 재개이므로 자동 제외됨.
    const stepType = turn === 0
        ? 'plan'
        : (hasToolCalls ? 'assistant_tool_call' : 'assistant');
    // 턴이 호출한 도구명 기록(콤마 결합) — 실행 결과는 tool_result 행에 남지만,
    // 중단/거부로 실행되지 않은 호출 의도까지 남겨 턴 단위 집계를 가능하게 한다.
    const turnToolNames = hasToolCalls
        ? result.tool_calls!.map((tc) => tc.function.name).join(',')
        : undefined;
    await db.addAgentTaskStep({
        taskId,
        stepNumber: stepNumber++,
        stepType,
        toolName: turnToolNames,
        content: stepContent,
        planStepIndex: planIdx(),
        // 호출 의도의 인자까지 영속(091) — 중단·거부로 실행되지 않아 tool_result 행이
        // 남지 않는 호출도 사후에 복기할 수 있게 한다(tool_name 영속과 같은 취지).
        toolArgs: hasToolCalls
            ? prepareToolArgs(result.tool_calls!.map((tc) => ({ name: tc.function.name, args: tc.function.arguments })))
            : undefined,
    });
    emitStep(stepType, turnToolNames, stepContent);
    return { hasToolCalls, extracted, stepContent, stepNumber };
}
