/**
 * goal-judge 유닛테스트 — 목표 달성 판정 LLM 1회 호출의 반환 계약과 fail-open 안전속성.
 *
 * 이 모듈이 담당하는 계약은 판정 결과(true=달성 / false=미달성 / null=판정 불가)뿐이다.
 * 게이트(AGENT_TASK_GOAL_JUDGE)·아티팩트 유무 분기·마커([GOAL_INCOMPLETE])·failed(goal_incomplete)
 * 종료는 호출자(AgentTaskService)가 담당하며 agent-task-input-files.test.ts 가 통합 커버한다.
 * 여기서는 judge 가 false 를 돌려주는 경로(계약의 goal-judge 쪽 절반)와 fail-open 을 고정한다.
 */
import { judgeGoalAchieved, buildJudgeExecutionContext, buildJudgeToolEvidence } from '../goal-judge';
import { AGENT_TASK_LIMITS } from '../../../config/runtime-limits';
import type { LLMClient } from '../../../llm';

/** chat mock 을 심은 LLMClient 스텁 생성. */
function makeClient(chat: jest.Mock): LLMClient {
    return { chat } as unknown as LLMClient;
}

const signal = new AbortController().signal;

describe('judgeGoalAchieved', () => {
    it('응답이 {"achieved": true} 면 true(달성) 를 반환한다', async () => {
        const chat = jest.fn().mockResolvedValue({ content: '{"achieved": true, "reason": "완료"}' });
        await expect(judgeGoalAchieved(makeClient(chat), 'goal', 'answer', signal)).resolves.toBe(true);
    });

    it('응답이 {"achieved": false} 면 false(미달성) 를 반환한다 — 호출자가 failed(goal_incomplete) 로 이어감', async () => {
        const chat = jest.fn().mockResolvedValue({ content: '{"achieved": false, "reason": "입력 자료 없음"}' });
        await expect(judgeGoalAchieved(makeClient(chat), 'goal', 'answer', signal)).resolves.toBe(false);
    });

    it('공백이 섞인 "achieved" : true 도 파싱한다', async () => {
        const chat = jest.fn().mockResolvedValue({ content: '{ "achieved"  :   true }' });
        await expect(judgeGoalAchieved(makeClient(chat), 'goal', 'answer', signal)).resolves.toBe(true);
    });

    // ---- fail-open 안전속성 (핵심 계약: 판정이 본 작업을 죽이지 않는다) ----

    it('fail-open — client.chat 이 throw 하면 null 을 반환한다(예외 전파 금지)', async () => {
        const chat = jest.fn().mockRejectedValue(new Error('upstream 500'));
        await expect(judgeGoalAchieved(makeClient(chat), 'goal', 'answer', signal)).resolves.toBeNull();
    });

    it('fail-open — abort/타임아웃으로 reject 돼도 null 을 반환한다', async () => {
        const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
        const chat = jest.fn().mockRejectedValue(abortErr);
        await expect(judgeGoalAchieved(makeClient(chat), 'goal', 'answer', signal)).resolves.toBeNull();
    });

    it('fail-open — 응답에 achieved 키가 없어 파싱 불가면 null 을 반환한다', async () => {
        const chat = jest.fn().mockResolvedValue({ content: '판정하기 어렵습니다.' });
        await expect(judgeGoalAchieved(makeClient(chat), 'goal', 'answer', signal)).resolves.toBeNull();
    });

    it('fail-open — content 가 null/undefined 여도 throw 없이 null 을 반환한다', async () => {
        const chatNull = jest.fn().mockResolvedValue({ content: null });
        await expect(judgeGoalAchieved(makeClient(chatNull), 'goal', 'answer', signal)).resolves.toBeNull();
        const chatUndef = jest.fn().mockResolvedValue({});
        await expect(judgeGoalAchieved(makeClient(chatUndef), 'goal', 'answer', signal)).resolves.toBeNull();
    });

    // ---- 호출 규약: think:false·signal 전달, answer 길이 캡, executionContext 주입 ----

    it('판정 호출은 think:false 와 caller signal 을 그대로 전달한다', async () => {
        const chat = jest.fn().mockResolvedValue({ content: '{"achieved": true}' });
        await judgeGoalAchieved(makeClient(chat), 'goal', 'answer', signal);
        const advanced = chat.mock.calls[0][3];
        expect(advanced).toMatchObject({ think: false, signal });
    });

    it('answer 는 GOAL_JUDGE_MAX_ANSWER_CHARS 로 잘려 프롬프트에 들어간다(초과분 유실)', async () => {
        const chat = jest.fn().mockResolvedValue({ content: '{"achieved": true}' });
        const max = AGENT_TASK_LIMITS.GOAL_JUDGE_MAX_ANSWER_CHARS;
        const answer = 'A'.repeat(max) + 'B'.repeat(50); // 초과 50자는 'B'
        await judgeGoalAchieved(makeClient(chat), 'goal', answer, signal);
        const userPrompt: string = chat.mock.calls[0][0][1].content;
        expect(userPrompt).toContain('A'.repeat(10));
        expect(userPrompt).not.toContain('B'); // 캡 초과분은 프롬프트에 없어야 함
    });

    it('executionContext 를 넘기면 판정 프롬프트에 실행 기록으로 포함된다', async () => {
        const chat = jest.fn().mockResolvedValue({ content: '{"achieved": true}' });
        await judgeGoalAchieved(makeClient(chat), 'goal', 'answer', signal, '사용 도구: web_search\n턴 수: 3');
        const userPrompt: string = chat.mock.calls[0][0][1].content;
        expect(userPrompt).toContain('web_search');
        expect(userPrompt).toContain('턴 수: 3');
    });

    it('goal 과 answer 는 판정 프롬프트에 원문으로 실린다', async () => {
        const chat = jest.fn().mockResolvedValue({ content: '{"achieved": true}' });
        await judgeGoalAchieved(makeClient(chat), 'CSV 매출 합계 산출', '합계는 450 입니다', signal);
        const userPrompt: string = chat.mock.calls[0][0][1].content;
        expect(userPrompt).toContain('CSV 매출 합계 산출');
        expect(userPrompt).toContain('합계는 450 입니다');
    });
});

describe('buildJudgeExecutionContext', () => {
    it('사용 도구·턴수·계획 완료 상태를 렌더한다', () => {
        const ctx = buildJudgeExecutionContext(
            new Set(['web_search', 'python_execute']),
            3,
            [{ status: 'completed' }, { status: 'completed' }, { status: 'pending' }],
        );
        expect(ctx).toContain('사용 도구: web_search, python_execute');
        expect(ctx).toContain('턴 수: 3');
        expect(ctx).toContain('계획: 2/3 단계 완료');
    });

    it('도구 미사용이면 "(없음 — 도구 미사용)" 로 표기한다', () => {
        const ctx = buildJudgeExecutionContext(new Set(), 1, []);
        expect(ctx).toContain('사용 도구: (없음 — 도구 미사용)');
        expect(ctx).toContain('턴 수: 1');
    });

    it('계획 스텝이 없으면 계획 줄을 생략한다', () => {
        const ctx = buildJudgeExecutionContext(new Set(['bash']), 2, []);
        expect(ctx).not.toContain('계획:');
    });

    // 회귀 고정(2026-08-15 실측 false negative): 모델이 완료 마킹을 생략하면 "0/N 완료"가
    // 미달성의 거짓 근거로 작동했다 — 완료 0이면 계획 줄 자체를 싣지 않는다.
    it('계획 완료가 0 이면 계획 줄을 싣지 않는다(마킹 누락이 미달성 근거로 오용되지 않게)', () => {
        const ctx = buildJudgeExecutionContext(
            new Set(['file_read', 'file_write']), 3,
            [{ status: 'in_progress' }, { status: 'not_started' }, { status: 'not_started' }],
        );
        expect(ctx).not.toContain('계획:');
        expect(ctx).toContain('file_write');
    });

    it('toolEvidence 를 넘기면 "최근 도구 실행 결과" 블록으로 포함된다', () => {
        const ctx = buildJudgeExecutionContext(new Set(['bash']), 2, [], '- bash: 기록됨: summary.txt');
        expect(ctx).toContain('최근 도구 실행 결과:');
        expect(ctx).toContain('기록됨: summary.txt');
    });
});

describe('buildJudgeToolEvidence', () => {
    it('tool 메시지만 골라 최근 N개를 도구명과 함께 한 줄씩 렌더한다', () => {
        const evidence = buildJudgeToolEvidence([
            { role: 'user', content: '목표' },
            { role: 'tool', content: 'e2e test folder', tool_name: 'file_read' },
            { role: 'assistant', content: '읽었습니다' },
            { role: 'tool', content: '기록됨:\nsummary.txt', tool_name: 'file_write' },
        ]);
        expect(evidence).toContain('- file_read: e2e test folder');
        // 개행은 공백으로 접혀 한 줄 항목이 된다
        expect(evidence).toContain('- file_write: 기록됨: summary.txt');
        expect(evidence).not.toContain('읽었습니다');
    });

    it('항목 수는 GOAL_JUDGE_EVIDENCE_MAX_ITEMS 로 캡되고 최근 것이 남는다', () => {
        const many = Array.from({ length: AGENT_TASK_LIMITS.GOAL_JUDGE_EVIDENCE_MAX_ITEMS + 3 }, (_, i) => (
            { role: 'tool', content: `result-${i}`, tool_name: 'bash' }
        ));
        const evidence = buildJudgeToolEvidence(many);
        expect(evidence.split('\n')).toHaveLength(AGENT_TASK_LIMITS.GOAL_JUDGE_EVIDENCE_MAX_ITEMS);
        expect(evidence).toContain(`result-${many.length - 1}`); // 마지막(최근) 포함
        expect(evidence).not.toContain('result-0'); // 가장 오래된 것 탈락
    });

    it('항목당 내용은 GOAL_JUDGE_EVIDENCE_ITEM_CHARS 로 잘린다', () => {
        const long = 'X'.repeat(AGENT_TASK_LIMITS.GOAL_JUDGE_EVIDENCE_ITEM_CHARS + 50);
        const evidence = buildJudgeToolEvidence([{ role: 'tool', content: long, tool_name: 'bash' }]);
        const line = evidence.split('\n')[0];
        expect(line.length).toBeLessThanOrEqual('- bash: '.length + AGENT_TASK_LIMITS.GOAL_JUDGE_EVIDENCE_ITEM_CHARS);
    });

    it('tool 메시지가 없으면 빈 문자열을 반환한다(EXECUTION 블록 미첨부)', () => {
        expect(buildJudgeToolEvidence([{ role: 'user', content: 'x' }])).toBe('');
    });
});
