// 임계값은 .env(AGENT_TASK_FINAL_TURN_MIN_ANSWER)에 좌우되므로 고정해 결정적으로 만든다.
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return {
        ...actual,
        AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, FINAL_TURN_MIN_ANSWER_CHARS: 200 },
    };
});

import { shouldAdoptFinalTurnAnswer, withMemorySaveExposure } from './turn-gate';
import { getAgentTaskSteeringInjection } from '../../prompts/agent-task-prompt';
import type { ChatMessage, ToolDefinition } from '../../llm/types';

const base = { finalTurn: true, hasNativeTools: true, hasTextTools: false, answerLength: 500 };

describe('shouldAdoptFinalTurnAnswer — 마무리 턴 본문 채택', () => {
    it('도구 호출이 섞여도 본문이 충분하면 채택한다 (완성 산출물 폐기 방지)', () => {
        expect(shouldAdoptFinalTurnAnswer(base)).toBe(true);
    });

    it('본문이 임계 미만인 의도 선언은 채택하지 않는다', () => {
        // 실측 사례: "Last turn. I need to produce the data.json ... Let me do this" (100자 안팎)
        expect(shouldAdoptFinalTurnAnswer({ ...base, answerLength: 100 })).toBe(false);
    });

    it('본문이 비었으면 채택하지 않는다', () => {
        expect(shouldAdoptFinalTurnAnswer({ ...base, answerLength: 0 })).toBe(false);
    });

    it('텍스트(XML) 도구 호출은 본문 자체가 호출문이라 채택하지 않는다', () => {
        expect(shouldAdoptFinalTurnAnswer({ ...base, hasNativeTools: false, hasTextTools: true })).toBe(false);
    });

    it('마무리 턴이 아니면 판정 대상이 아니다 (정상 도구 루프)', () => {
        expect(shouldAdoptFinalTurnAnswer({ ...base, finalTurn: false })).toBe(false);
    });

    it('도구 호출이 없으면 이 경로를 타지 않는다', () => {
        expect(shouldAdoptFinalTurnAnswer({ ...base, hasNativeTools: false })).toBe(false);
    });

    it('임계 경계값은 채택한다', () => {
        expect(shouldAdoptFinalTurnAnswer({ ...base, answerLength: 200 })).toBe(true);
        expect(shouldAdoptFinalTurnAnswer({ ...base, answerLength: 199 })).toBe(false);
    });
});

describe('withMemorySaveExposure — 메모리 저장 도구는 사용자가 청했을 때만 모델에 보여 준다', () => {
    const t = (name: string): ToolDefinition => ({ type: 'function', function: { name, description: '', parameters: { type: 'object', properties: {} } } });
    const tools = [t('bash'), t('memory_save'), t('view')];
    const names = (conv: ChatMessage[]) => withMemorySaveExposure(tools, conv).map((x) => x.function.name);

    it('목표에 저장 의도가 없으면 뺀다 — 다른 도구는 그대로', () => {
        expect(names([{ role: 'user', content: '보고서를 써 줘' }])).toEqual(['bash', 'view']);
    });
    it('목표가 저장을 청하면 그대로 둔다', () => {
        expect(names([{ role: 'user', content: '내가 표를 좋아한다는 걸 기억해 줘' }])).toEqual(['bash', 'memory_save', 'view']);
    });
    it('작업 도중 지시가 저장을 청하면 그 턴부터 보여 준다', () => {
        const conv: ChatMessage[] = [{ role: 'user', content: '보고서를 써 줘' }];
        expect(names(conv)).toEqual(['bash', 'view']);
        conv.push({ role: 'user', content: getAgentTaskSteeringInjection('그리고 이 형식을 기억해 줘') });
        expect(names(conv)).toEqual(['bash', 'memory_save', 'view']);
    });
});
