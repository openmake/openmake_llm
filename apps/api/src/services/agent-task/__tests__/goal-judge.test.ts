/**
 * goal-judge 유닛테스트 — 목표 달성 판정 LLM 1회 호출의 반환 계약과 fail-open 안전속성.
 *
 * 이 모듈이 담당하는 계약은 판정 결과(true=달성 / false=미달성 / null=판정 불가)뿐이다.
 * 게이트(AGENT_TASK_GOAL_JUDGE)·아티팩트 유무 분기·마커([GOAL_INCOMPLETE])·failed(goal_incomplete)
 * 종료는 호출자(AgentTaskService)가 담당하며 agent-task-input-files.test.ts 가 통합 커버한다.
 * 여기서는 judge 가 false 를 돌려주는 경로(계약의 goal-judge 쪽 절반)와 fail-open 을 고정한다.
 */
import { judgeGoalAchieved, buildJudgeExecutionContext } from '../goal-judge';
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
});
