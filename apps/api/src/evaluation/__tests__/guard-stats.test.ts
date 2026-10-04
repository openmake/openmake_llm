/**
 * 가드 발동 집계 — 표지(guard-stats-markers)가 코드가 실제로 남기는 문구에 맞는지, 집계가 건수·작업 수를 바르게 세는지.
 * 문구를 바꾸면 이 테스트가 깨져 표지를 함께 고치게 된다.
 */
import { classifyGuardStep, summarizeGuardStats, parseSince, turnDistribution, type GuardStepRow } from '../guard-stats';
import { GUARD_STEP_MARKERS } from '../guard-stats-markers';
import { truncateToolResult } from '../../services/agent-task/tool-result-truncate';
import {
    getToolLoopFailureNote, getToolLoopSameResultNote, getToolLoopBlockedResult,
} from '../../prompts/agent-task-prompt';
import {
    getTransientRetryNote, getRecoveryWaitNote, getAgentTaskStallNote, getContextTrimNote, getMalformedToolArgsResult,
    getDuplicateToolCallResult, getOutputRepetitionNote, getVerifyHeldAnswerNote,
} from '../../prompts/agent-task-turn-loop';
import { getApprovalRejectedNotice } from '../../prompts/agent-task-approval';
import { BROWSER_BOT_BLOCK_NOTICE } from '../../prompts/agent-task-browser-web';
import { getToolResultSpillNotice } from '../../prompts/agent-task-context';
import { verifySkippedMessage } from '../../services/agent-task/task-steps';

const step = (step_type: string, content: string, task_id = 't1'): GuardStepRow => ({ task_id, step_type, content });

describe('classifyGuardStep — 코드가 남기는 실제 문구', () => {
    const cases: Array<[string, GuardStepRow]> = [
        ['tool_result_truncated', step('tool_result', truncateToolResult('x'.repeat(200), 100, 0.5))],
        ['tool_result_spilled', step('tool_result', `앞부분\n${getToolResultSpillNotice('.omk/results/a.txt', 9000, 300, 40)}`)],
        ['empty_response_retry', step('retry', '빈 응답 — 되묻기 1/2')],
        ['transient_retry', step('retry', getTransientRetryNote(1, 2, 'Connection error.'))],
        ['call_cap_retry', step('retry', getTransientRetryNote(1, 1, '호출 상한(300초) 초과 — 다시 시도'))],
        ['recovery_wait', step('retry', getTransientRetryNote(1, 5, getRecoveryWaitNote('Connection error.', 15_000)))],
        ['stall_nudge', step('retry', getAgentTaskStallNote(1, 2))],
        ['malformed_args_rejected', step('tool_result', getMalformedToolArgsResult('bash'))],
        ['duplicate_call_removed', step('tool_result', getDuplicateToolCallResult('grep_code', 'call_1'))],
        ['loop_warn_failure', step('tool_result', `Error: boom${getToolLoopFailureNote(2)}`)],
        ['loop_warn_same_result', step('tool_result', `same${getToolLoopSameResultNote(3)}`)],
        ['loop_block_failure', step('tool_result', getToolLoopBlockedResult('bash', 4, 'failure'))],
        ['loop_block_same_result', step('tool_result', getToolLoopBlockedResult('grep_code', 5, 'same_result'))],
        ['context_trim', step('context_trim', getContextTrimNote(3, 40))],
        ['output_repetition', step('output_repetition', getOutputRepetitionNote(5, 60, 'abc'))],
        ['verify_skipped', step('verify_skipped', verifySkippedMessage(['tests']))],
        ['verify_held_answer', step('verify_skipped', getVerifyHeldAnswerNote(['tests']))],
        ['approval_rejected_user', step('tool_result', getApprovalRejectedNotice('bash', 'user', '위험해 보임'))],
        ['approval_rejected_unattended', step('tool_result', getApprovalRejectedNotice('bash', 'unattended'))],
        ['approval_timeout', step('tool_result', getApprovalRejectedNotice('bash', 'timeout'))],
        ['bot_block_warning', step('tool_result', `본문\n\n${BROWSER_BOT_BLOCK_NOTICE}`)],
    ];

    it.each(cases)('%s 하나로만 분류된다', (id, row) => {
        expect(classifyGuardStep(row)).toEqual([id]);
    });

    it('설정의 모든 표지에 실제 문구 표본이 있다', () => {
        expect(cases.map(([id]) => id).sort()).toEqual(GUARD_STEP_MARKERS.map((m) => m.id).sort());
    });

    it('평범한 도구 결과·다른 스텝 종류는 아무 현상도 아니다', () => {
        expect(classifyGuardStep(step('tool_result', 'Error: No such file or directory'))).toEqual([]);
        expect(classifyGuardStep(step('assistant', getToolLoopFailureNote(2)))).toEqual([]);
        expect(classifyGuardStep(step('tool_result', null as unknown as string))).toEqual([]);
    });
});

describe('summarizeGuardStats', () => {
    it('현상별 발동 건수와 겪은 작업 수를 센다', () => {
        const s = summarizeGuardStats(
            [
                { id: 't1', status: 'completed', failure_class: null, current_turn: 2 },
                { id: 't2', status: 'failed', failure_class: 'goal_incomplete', current_turn: 8 },
                { id: 't3', status: 'completed', failure_class: null, current_turn: 3 },
            ],
            [
                step('tool_result', `Error: boom${getToolLoopFailureNote(2)}`, 't2'),
                step('tool_result', `Error: boom${getToolLoopFailureNote(3)}`, 't2'),
                step('tool_result', getToolLoopBlockedResult('bash', 4, 'failure'), 't2'),
                step('retry', '빈 응답 — 되묻기 1/2', 't1'),
            ],
        );
        expect(s.tasks.total).toBe(3);
        expect(s.tasks.byStatus).toEqual({ completed: 2, failed: 1 });
        expect(s.tasks.byFailureClass).toEqual({ goal_incomplete: 1 });
        const by = Object.fromEntries(s.phenomena.map((p) => [p.id, p]));
        expect(by.loop_warn_failure).toMatchObject({ occurrences: 2, tasks: 1 });
        expect(by.loop_block_failure).toMatchObject({ occurrences: 1, tasks: 1 });
        expect(by.empty_response_retry).toMatchObject({ occurrences: 1, tasks: 1 });
        expect(by.stall_nudge).toMatchObject({ occurrences: 0, tasks: 0 });
        expect(s.phenomena).toHaveLength(GUARD_STEP_MARKERS.length);
    });
});

describe('summarizeGuardStats — 재시작 정리로 끊긴 작업', () => {
    it("'server restarted' 전이가 남은 작업은 상태·실패 분류에 섞지 않고 따로 센다", () => {
        const s = summarizeGuardStats(
            [
                { id: 't1', status: 'completed', failure_class: null, current_turn: 2 },
                // 좀비 정리에 걸린 뒤 끝까지 돌아 전이가 거부된 평가 작업 — 기록상 failed/unknown 이지만 작업의 실패가 아니다
                { id: 't2', status: 'failed', failure_class: 'unknown', current_turn: 3, restarted: true },
                { id: 't3', status: 'failed', failure_class: 'interrupted', current_turn: 1, restarted: true },
                { id: 't4', status: 'failed', failure_class: 'goal_incomplete', current_turn: 4 },
            ],
            [],
        );
        expect(s.tasks.total).toBe(4);
        expect(s.tasks.restartInterrupted).toBe(2);
        expect(s.tasks.byStatus).toEqual({ completed: 1, failed: 1 });
        expect(s.tasks.byFailureClass).toEqual({ goal_incomplete: 1 });
    });
});

describe('turnDistribution', () => {
    it('턴 수의 최소·중앙·p90·최대·평균과 값별 건수', () => {
        expect(turnDistribution([2, 2, 3, 4, 10])).toEqual({ n: 5, min: 2, p50: 3, p90: 10, max: 10, mean: 4.2, histogram: { 2: 2, 3: 1, 4: 1, 10: 1 } });
        expect(turnDistribution([])).toEqual({ n: 0, min: 0, p50: 0, p90: 0, max: 0, mean: 0, histogram: {} });
    });
});

describe('parseSince', () => {
    const now = Date.parse('2026-10-04T00:00:00Z');
    it('"7d" 는 7일 전, 날짜 문자열은 그 시각', () => {
        expect(parseSince('7d', now)?.toISOString()).toBe('2026-09-27T00:00:00.000Z');
        expect(parseSince('2026-10-01', now)?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    });
    it('없으면 undefined, 못 읽으면 던진다', () => {
        expect(parseSince(undefined, now)).toBeUndefined();
        expect(() => parseSince('어제', now)).toThrow();
    });
});
