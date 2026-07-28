/** recoverTextToolCalls — 텍스트로 누출된 도구 호출 XML(Anthropic/Hermes) 파싱 검증. */
import { recoverTextToolCalls } from '../text-tool-calls';

describe('recoverTextToolCalls', () => {
    it('Anthropic <invoke> 형식 파싱 (bash 명령)', () => {
        const content = `설명\n<invoke name="bash">\n<parameter name="command">echo hi > /workspace/a.txt</parameter>\n</invoke>`;
        const r = recoverTextToolCalls(content);
        expect(r).toHaveLength(1);
        expect(r[0].function.name).toBe('bash');
        expect(r[0].function.arguments).toEqual({ command: 'echo hi > /workspace/a.txt' });
        expect(r[0].type).toBe('function');
    });

    it('multi-parameter <invoke> 파싱', () => {
        const content = `<invoke name="file_ops"><parameter name="op">write</parameter><parameter name="path">a.txt</parameter></invoke>`;
        const r = recoverTextToolCalls(content);
        expect(r[0].function.arguments).toEqual({ op: 'write', path: 'a.txt' });
    });

    it('여러 <invoke> 를 순서대로 모두 파싱', () => {
        const content = `<invoke name="bash"><parameter name="command">a</parameter></invoke> 그리고 <invoke name="bash"><parameter name="command">b</parameter></invoke>`;
        const r = recoverTextToolCalls(content);
        expect(r.map((c) => c.function.arguments)).toEqual([{ command: 'a' }, { command: 'b' }]);
        expect(new Set(r.map((c) => c.id)).size).toBe(2); // id 유일
    });

    it('Hermes <tool_call>{json} 형식 파싱', () => {
        const content = `<tool_call>{"name":"python_execute","arguments":{"code":"print(1)"}}</tool_call>`;
        const r = recoverTextToolCalls(content);
        expect(r[0].function.name).toBe('python_execute');
        expect(r[0].function.arguments).toEqual({ code: 'print(1)' });
    });

    it('도구 XML 없으면 빈 배열', () => {
        expect(recoverTextToolCalls('그냥 일반 텍스트 답변입니다.')).toEqual([]);
        expect(recoverTextToolCalls('')).toEqual([]);
    });

    it('깨진 Hermes JSON 은 건너뜀(throw 안 함)', () => {
        expect(recoverTextToolCalls('<tool_call>{not json}</tool_call>')).toEqual([]);
    });
});
