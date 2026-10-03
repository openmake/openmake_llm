import { priorRepetition, repetitionVerdict } from './tool-loop-guard';
import { getDuplicateToolCallResult } from '../../prompts/agent-task-turn-loop';
import type { ChatMessage } from '../../llm/types';

let seq = 0;
/** 대화에 (assistant 도구 호출 + tool 결과) 한 쌍을 덧붙인다. */
function round(conv: ChatMessage[], name: string, args: Record<string, unknown>, result: string): void {
    const id = `c${seq++}`;
    conv.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: args } }] });
    conv.push({ role: 'tool', content: result, tool_name: name, tool_call_id: id });
}
const base = (): ChatMessage[] => [{ role: 'system', content: 's' }, { role: 'user', content: 'g' }];
const limits = { warnFailures: 2, blockFailures: 4, warnSameResult: 3, blockSameResult: 5 };

describe('priorRepetition — 대화에서 직전까지의 같은 호출 반복을 센다', () => {
    it('같은 이름·인자로 연속 실패한 횟수를 센다(인자 키 순서 무관)', () => {
        const conv = base();
        round(conv, 'bash', { command: 'npm test', cwd: '.' }, 'Error: [stderr]\nboom\n[exit=1 5ms]');
        round(conv, 'bash', { cwd: '.', command: 'npm test' }, 'Error: [stderr]\nboom\n[exit=1 6ms]');
        expect(priorRepetition(conv, 'bash', { command: 'npm test', cwd: '.' })).toEqual(expect.objectContaining({ failures: 2 }));
    });

    it('다른 호출이 사이에 끼면 다시 센다', () => {
        const conv = base();
        round(conv, 'bash', { command: 'npm test' }, 'Error: boom');
        round(conv, 'str_replace_editor', { command: 'view', path: 'a.ts' }, 'ok');
        round(conv, 'bash', { command: 'npm test' }, 'Error: boom');
        expect(priorRepetition(conv, 'bash', { command: 'npm test' }).failures).toBe(1);
    });

    it('같은 호출이 같은 결과를 돌려준 연속 횟수를 센다', () => {
        const conv = base();
        round(conv, 'file_ops', { op: 'read', path: 'a.txt' }, '내용');
        round(conv, 'file_ops', { op: 'read', path: 'a.txt' }, '내용');
        const r = priorRepetition(conv, 'file_ops', { op: 'read', path: 'a.txt' });
        expect(r.sameResult).toBe(2);
        expect(r.lastResult).toBe('내용');
    });

    it('데이터 래퍼(<tool_output>)에 싸인 오류도 실패로 본다', () => {
        const conv = base();
        round(conv, 'web_search', { query: 'x' }, '<tool_output>\nError: timeout\n</tool_output>\n목표: ...');
        expect(priorRepetition(conv, 'web_search', { query: 'x' }).failures).toBe(1);
    });
});

describe('priorRepetition — 중복 호출 안내 결과', () => {
    it('한 응답 안의 중복 호출에 준 짧은 결과는 반복 집계에서 뺀다(같은 결과 연속이 끊기지 않게)', () => {
        const conv = base();
        round(conv, 'grep_code', { pattern: 'x' }, '결과 A');
        round(conv, 'grep_code', { pattern: 'x' }, getDuplicateToolCallResult('grep_code', 'c0'));
        round(conv, 'grep_code', { pattern: 'x' }, '결과 A');
        expect(priorRepetition(conv, 'grep_code', { pattern: 'x' })).toEqual(expect.objectContaining({ sameResult: 2, lastResult: '결과 A' }));
    });
});

describe('repetitionVerdict', () => {
    it('연속 실패가 차단 임계에 닿으면 실행하지 않는다', () => {
        expect(repetitionVerdict({ failures: 4, sameResult: 0 }, { readOnly: false }, limits).block).toBe(true);
        expect(repetitionVerdict({ failures: 3, sameResult: 0 }, { readOnly: false }, limits).block).toBe(false);
    });

    it('같은 결과 반복은 읽기 전용 호출만 차단한다', () => {
        expect(repetitionVerdict({ failures: 0, sameResult: 5 }, { readOnly: true }, limits).block).toBe(true);
        expect(repetitionVerdict({ failures: 0, sameResult: 5 }, { readOnly: false }, limits).block).toBe(false);
    });

    it('이번 결과까지 합쳐 경고 임계에 닿으면 안내를 붙인다', () => {
        const v = repetitionVerdict({ failures: 1, sameResult: 0 }, { readOnly: false }, limits);
        expect(v.noteFor('Error: boom')).toContain('2번');
        expect(v.noteFor('[stdout]\nok\n[exit=0 3ms]')).toBe('');
        const s = repetitionVerdict({ failures: 0, sameResult: 2, lastResult: '내용' }, { readOnly: true }, limits);
        expect(s.noteFor('내용')).toContain('같은 결과');
        expect(s.noteFor('바뀐 내용')).toBe('');
    });
});
