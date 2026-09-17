import { buildApprovalPreview, unifiedDiff } from '../approval-preview';

const files: Record<string, string> = { 'a.txt': 'one\ntwo\nthree\n', 'secret.env': 'K=1\n' };
const read = async (p: string) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; };

describe('unifiedDiff', () => {
    test('변경 줄만 +/- 로, 동일하면 빈 문자열', () => {
        expect(unifiedDiff('a', 'x', 'x')).toBe('');
        const d = unifiedDiff('a.txt', 'one\ntwo\nthree', 'one\n2\nthree');
        expect(d).toContain('--- a/a.txt'); expect(d).toContain('-two'); expect(d).toContain('+2'); expect(d).toContain('@@');
    });
});

describe('buildApprovalPreview', () => {
    test('create: 전량 +', async () => {
        const d = await buildApprovalPreview('str_replace_editor', { command: 'create', path: 'new.txt', file_text: 'hello\nworld' }, read);
        expect(d).toContain('+hello'); expect(d).toContain('+world');
    });
    test('str_replace: 유일 매칭만, 없으면 null', async () => {
        expect(await buildApprovalPreview('str_replace_editor', { command: 'str_replace', path: 'a.txt', old_str: 'two', new_str: 'TWO' }, read)).toContain('+TWO');
        expect(await buildApprovalPreview('str_replace_editor', { command: 'str_replace', path: 'a.txt', old_str: 'nope', new_str: 'x' }, read)).toBeNull();
    });
    test('insert / file_ops write·delete / 미지 도구', async () => {
        expect(await buildApprovalPreview('str_replace_editor', { command: 'insert', path: 'a.txt', insert_line: 1, new_str: 'mid' }, read)).toContain('+mid');
        expect(await buildApprovalPreview('file_ops', { op: 'write', path: 'a.txt', content: 'one\n' }, read)).toContain('-two');
        const del = await buildApprovalPreview('file_ops', { op: 'delete', path: 'secret.env' }, read);
        expect(del).toContain('-K=1');
        expect(await buildApprovalPreview('bash', { command: 'rm -rf' }, read)).toBeNull();
        expect(await buildApprovalPreview('file_ops', { op: 'read', path: 'a.txt' }, read)).toBeNull();
    });
    test('읽기 실패: create/write 는 새 파일, str_replace 는 null', async () => {
        expect(await buildApprovalPreview('file_ops', { op: 'write', path: 'missing.txt', content: 'x' }, read)).toContain('+x');
        expect(await buildApprovalPreview('str_replace_editor', { command: 'str_replace', path: 'missing.txt', old_str: 'a', new_str: 'b' }, read)).toBeNull();
    });
});
