/**
 * 안정화 신호(작업 지표)의 단계 기록 표지 — SQL LIKE 문구가 실제로 남는 문구와 맞는지 본다.
 * 원본 문구(prompts/agent-task-*.ts, AgentTaskService 의 retry 스텝)를 바꾸면 여기서 깨진다 — 그때 표지도 고친다.
 */
import { AGENT_TASK_STABILITY_STEP_SIGNALS } from '../agent-task-metrics';
import { getTransientRetryNote, getRecoveryWaitNote, getToolCallTimeoutResult, getMalformedToolArgsResult } from '../../prompts/agent-task-turn-loop';
import { getToolLoopBlockedResult } from '../../prompts/agent-task-prompt';
import { getApprovalRejectedNotice } from '../../prompts/agent-task-approval';

/** SQL LIKE → 정규식(% 만 쓴다). */
const likeToRegExp = (like: string): RegExp =>
    new RegExp(`^${like.split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')}$`);
const matches = (id: string, content: string): boolean => {
    const s = AGENT_TASK_STABILITY_STEP_SIGNALS.find((x) => x.id === id);
    if (!s) throw new Error(`표지 없음: ${id}`);
    return s.like === undefined ? true : likeToRegExp(s.like).test(content);
};

describe('AGENT_TASK_STABILITY_STEP_SIGNALS', () => {
    it('id 는 소문자·밑줄뿐이고 겹치지 않는다(SQL 별칭으로 쓴다)', () => {
        const ids = AGENT_TASK_STABILITY_STEP_SIGNALS.map((s) => s.id);
        for (const id of ids) expect(id).toMatch(/^[a-z_]+$/);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('모델 호출 재시도 — 짧은 재시도와 소진 뒤 대기를 모두 잡고, 대기는 따로도 센다', () => {
        const short = getTransientRetryNote(1, 2, '500 Internal Server Error');
        const wait = getTransientRetryNote(1, 5, getRecoveryWaitNote('Connection error.', 15_000));
        expect(matches('llm_retry', short)).toBe(true);
        expect(matches('llm_retry', wait)).toBe(true);
        expect(matches('llm_recovery_wait', short)).toBe(false);
        expect(matches('llm_recovery_wait', wait)).toBe(true);
    });

    it('빈 응답 되묻기', () => {
        expect(matches('empty_response_retry', '빈 응답 — 되묻기 1/2')).toBe(true);
        expect(matches('empty_response_retry', getTransientRetryNote(1, 2, 'x'))).toBe(false);
    });

    it('반복 가드 차단 — 연속 실패·같은 결과 둘 다, 다른 "실행하지 않았습니다" 결과는 아니다', () => {
        expect(matches('loop_guard_block', getToolLoopBlockedResult('bash', 4, 'failure'))).toBe(true);
        expect(matches('loop_guard_block', getToolLoopBlockedResult('web_search', 5, 'same_result'))).toBe(true);
        expect(matches('loop_guard_block', getMalformedToolArgsResult('bash'))).toBe(false);
        expect(matches('loop_guard_block', getApprovalRejectedNotice('bash', 'unattended'))).toBe(false);
    });

    it('도구 호출 시간 상한', () => {
        expect(matches('tool_call_timeout', getToolCallTimeoutResult('extract_webpage', 900_000))).toBe(true);
        expect(matches('tool_call_timeout', 'Error: 외부 도구 타임아웃: a::b (30000ms 초과)')).toBe(false);
    });
});
