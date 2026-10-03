import { estimateConversationTokens, estimateToolSchemaTokens, calibrationScale } from './context-estimate';
import { estimateMessageTokens } from '../../llm/model-pool';
import type { ChatMessage, ToolDefinition } from '../../llm/types';

const tool: ToolDefinition = {
    type: 'function',
    function: { name: 'bash', description: '셸 명령을 실행합니다', parameters: { type: 'object', properties: { command: { type: 'string', description: 'x'.repeat(400) } }, required: ['command'] } },
};

describe('estimateConversationTokens', () => {
    it('도구 호출 인자를 센다 — 본문만 세는 추정보다 크다', () => {
        const withCall: ChatMessage[] = [{
            role: 'assistant', content: '',
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'file_ops', arguments: { op: 'write', path: 'a.md', content: '가'.repeat(3000) } } }],
        }];
        expect(estimateMessageTokens(withCall)).toBeLessThan(10); // 종전: 본문이 비어 거의 0
        expect(estimateConversationTokens(withCall)).toBeGreaterThan(3000);
    });

    it('도구 호출이 없으면 종전 추정과 같다', () => {
        const plain: ChatMessage[] = [{ role: 'user', content: 'hello world' }, { role: 'assistant', content: '안녕하세요' }];
        expect(estimateConversationTokens(plain)).toBe(estimateMessageTokens(plain));
    });
});

describe('estimateToolSchemaTokens', () => {
    it('도구 스키마를 센다, 도구가 없으면 0', () => {
        expect(estimateToolSchemaTokens([tool])).toBeGreaterThan(100);
        expect(estimateToolSchemaTokens([])).toBe(0);
    });
});

describe('calibrationScale', () => {
    it('직전 실제 사용량이 추정보다 크면 그 비율', () => {
        expect(calibrationScale({ estimated: 1000, actual: 1800 })).toBeCloseTo(1.8);
    });
    it('실제가 추정보다 작으면 1(추정을 낮추지 않는다)', () => {
        expect(calibrationScale({ estimated: 1000, actual: 600 })).toBe(1);
    });
    it('기록이 없거나 0이면 1, 터무니없는 비율은 상한으로 묶는다', () => {
        expect(calibrationScale(undefined)).toBe(1);
        expect(calibrationScale({ estimated: 0, actual: 500 })).toBe(1);
        expect(calibrationScale({ estimated: 10, actual: 100000 })).toBe(4);
    });
});
