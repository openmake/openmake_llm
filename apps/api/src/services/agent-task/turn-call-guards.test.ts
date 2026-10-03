import { findDuplicateCalls } from './turn-call-guards';
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import type { ToolCall } from '../../llm/types';

const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({ id, type: 'function', function: { name, arguments: args } });

describe('findDuplicateCalls — 한 응답 안의 같은 읽기 호출', () => {
    it('이름·인자가 같은 읽기 호출은 첫 호출만 남기고 나머지를 중복으로 본다(인자 키 순서 무관)', () => {
        const a = call('a', 'grep_code', { pattern: 'foo', path: 'src' });
        const b = call('b', 'grep_code', { path: 'src', pattern: 'foo' });
        const c = call('c', 'grep_code', { pattern: 'bar', path: 'src' });
        const d = call('d', 'grep_code', { pattern: 'foo', path: 'src' });
        const dup = findDuplicateCalls([a, b, c, d]);
        expect(dup.get(b)).toBe(a);
        expect(dup.get(d)).toBe(a);
        expect(dup.size).toBe(2);
    });

    it('검색 도구와 조회용 외부 MCP 도구도 합친다', () => {
        const a = call('a', 'web_search', { query: 'x' });
        const b = call('b', 'web_search', { query: 'x' });
        const c = call('c', 'kakao::search-web', { q: 'x' });
        const d = call('d', 'kakao::search-web', { q: 'x' });
        const dup = findDuplicateCalls([a, b, c, d]);
        expect(dup.get(b)).toBe(a);
        expect(dup.get(d)).toBe(c);
    });

    it('부작용이 있는 도구(쓰기·셸·위임·질문·표에 없는 외부 도구)는 같아도 중복으로 보지 않는다', () => {
        const calls = [
            call('g', 'delegate', { task: 'x' }), call('h', 'delegate', { task: 'x' }),
            call('i', 'ask_human', { question: 'x' }), call('j', 'ask_human', { question: 'x' }),
            call('a', 'bash', { command: 'npm test' }), call('b', 'bash', { command: 'npm test' }),
            call('c', 'file_ops', { op: 'write', path: 'a.txt', content: 'x' }), call('d', 'file_ops', { op: 'write', path: 'a.txt', content: 'x' }),
            call('e', 'some_server::send', { to: 'x' }), call('f', 'some_server::send', { to: 'x' }),
        ];
        expect(findDuplicateCalls(calls).size).toBe(0);
    });

    it('인자에 따라 읽기인 호출은 읽기일 때만 합친다', () => {
        const a = call('a', 'file_ops', { op: 'read', path: 'a.txt' });
        const b = call('b', 'file_ops', { op: 'read', path: 'a.txt' });
        expect(findDuplicateCalls([a, b]).get(b)).toBe(a);
    });

    it('끄면 아무것도 중복으로 보지 않는다', () => {
        const cfg = AGENT_TASK_TURN_LOOP as { DEDUPE_TOOL_CALLS: boolean };
        cfg.DEDUPE_TOOL_CALLS = false;
        try {
            expect(findDuplicateCalls([call('a', 'grep_code', { pattern: 'x' }), call('b', 'grep_code', { pattern: 'x' })]).size).toBe(0);
        } finally { cfg.DEDUPE_TOOL_CALLS = true; }
    });
});
