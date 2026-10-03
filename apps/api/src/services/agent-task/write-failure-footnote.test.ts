import { unresolvedWriteFailures, withWriteFailureFootnote } from './write-failure-footnote';
import type { ChatMessage } from '../../llm/types';

let seq = 0;
/** 도구 호출 한 번(assistant + tool 메시지 쌍). */
function call(name: string, args: Record<string, unknown>, result: string): ChatMessage[] {
    const id = `c${++seq}`;
    return [
        { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: args } }] } as ChatMessage,
        { role: 'tool', content: result, tool_name: name, tool_call_id: id } as ChatMessage,
    ];
}
const editFail = (path: string): ChatMessage[] => call('str_replace_editor', { command: 'str_replace', path, old_str: 'a', new_str: 'b' }, 'Error: old_str 를 찾을 수 없습니다');
const editOk = (path: string): ChatMessage[] => call('str_replace_editor', { command: 'str_replace', path, old_str: 'a', new_str: 'b' }, `치환 완료: ${path}`);

describe('파일 변경 실패 각주', () => {
    it('끝까지 성공하지 못한 경로만 남긴다', () => {
        const conv = [...editFail('a.ts'), ...editFail('b.ts'), ...editOk('a.ts')];
        expect(unresolvedWriteFailures(conv)).toEqual(['b.ts']);
    });

    it('성공한 뒤 다시 실패하면 남는다', () => {
        expect(unresolvedWriteFailures([...editOk('a.ts'), ...editFail('a.ts')])).toEqual(['a.ts']);
    });

    it('file_ops write·delete 실패도 본다', () => {
        const conv = [
            ...call('file_ops', { op: 'write', path: './out/r.md', content: 'x' }, 'Error: 파일 작업 실패: quota'),
            ...call('file_ops', { op: 'delete', path: 'old.txt' }, 'Error: 사용자가 도구 실행을 승인하지 않았습니다 (file_ops).'),
        ];
        expect(unresolvedWriteFailures(conv)).toEqual(['out/r.md', 'old.txt']);
    });

    it('읽기 호출의 실패는 세지 않는다', () => {
        const conv = [
            ...call('str_replace_editor', { command: 'view', path: 'nope.ts' }, 'Error: 편집 실패: ENOENT'),
            ...call('file_ops', { op: 'read', path: 'nope.ts' }, 'Error: 파일 작업 실패: ENOENT'),
        ];
        expect(unresolvedWriteFailures(conv)).toEqual([]);
    });

    it('실패 뒤 셸·파이썬이 그 경로를 다루고 성공했으면 해결된 것으로 본다', () => {
        const conv = [...editFail('src/a.ts'), ...call('bash', { command: "sed -i 's/a/b/' src/a.ts" }, '[exit=0 3ms]')];
        expect(unresolvedWriteFailures(conv)).toEqual([]);
        const failedShell = [...editFail('src/a.ts'), ...call('bash', { command: "sed -i 's/a/b/' src/a.ts" }, 'Error: [exit=1 3ms]')];
        expect(unresolvedWriteFailures(failedShell)).toEqual(['src/a.ts']);
    });

    it('각주는 실패가 남았을 때만 본문 뒤에 붙는다', () => {
        expect(withWriteFailureFootnote('끝냈습니다.', [...editOk('a.ts')])).toBe('끝냈습니다.');
        const out = withWriteFailureFootnote('끝냈습니다.', [...editFail('a.ts'), ...editFail('b.ts')]);
        expect(out.startsWith('끝냈습니다.\n\n')).toBe(true);
        expect(out).toContain('a.ts');
        expect(out).toContain('b.ts');
    });

    it('경로가 많으면 상한까지만 적고 나머지는 개수로 알린다', () => {
        const conv = Array.from({ length: 12 }, (_, i) => editFail(`f${i}.ts`)).flat();
        const out = withWriteFailureFootnote('끝.', conv);
        expect(out).toContain('f9.ts');
        expect(out).not.toContain('f10.ts');
        expect(out).toContain('외 2개');
    });

    it('끄면 붙이지 않는다', () => {
        expect(withWriteFailureFootnote('끝.', [...editFail('a.ts')], false)).toBe('끝.');
    });

    it('대화가 없으면 본문 그대로다', () => {
        expect(withWriteFailureFootnote('끝.', undefined)).toBe('끝.');
    });
});
