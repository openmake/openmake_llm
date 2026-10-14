/** v1 호환 응답의 OpenMake 확장 — 작업 게이트 제안은 있을 때만 message.task_suggestion 으로 실린다 */
import { OpenAICompatService } from '../OpenAICompatService';

const base = { id: 'c1', model: 'm', content: '답', finishReason: 'stop' as const, promptTokens: 1, completionTokens: 1 };

describe('OpenAICompatService.buildResponse — task_suggestion', () => {
    it('제안이 있으면 message.task_suggestion.p_true 로 싣는다', () => {
        const r = OpenAICompatService.buildResponse({ ...base, taskSuggestion: { pTrue: 0.95 } });
        expect(r.choices[0].message.task_suggestion).toEqual({ p_true: 0.95 });
    });

    it('제안이 없으면 키 자체가 없다', () => {
        const r = OpenAICompatService.buildResponse(base);
        expect('task_suggestion' in r.choices[0].message).toBe(false);
    });
});

describe('OpenAICompatService.buildResponse — agent_tasks', () => {
    it('위임 작업이 있으면 message.agent_tasks 로 싣는다', () => {
        const tasks = [{ id: 't1', goal: 'g', status: 'created' as const }];
        const r = OpenAICompatService.buildResponse({ ...base, agentTasks: tasks });
        expect(r.choices[0].message.agent_tasks).toEqual(tasks);
    });

    it('비어 있거나 없으면 키 자체가 없다', () => {
        expect('agent_tasks' in OpenAICompatService.buildResponse({ ...base, agentTasks: [] }).choices[0].message).toBe(false);
        expect('agent_tasks' in OpenAICompatService.buildResponse(base).choices[0].message).toBe(false);
    });
});
