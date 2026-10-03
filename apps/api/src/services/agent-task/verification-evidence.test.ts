import { classifyShellCommand, collectVerificationEvidence } from './verification-evidence';
import type { ChatMessage } from '../../llm/types';

let seq = 0;
function call(name: string, args: Record<string, unknown>, result: string): ChatMessage[] {
    const id = `c${++seq}`;
    return [
        { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: args } }] } as ChatMessage,
        { role: 'tool', content: result, tool_name: name, tool_call_id: id } as ChatMessage,
    ];
}
const bash = (command: string, exit = 0): ChatMessage[] =>
    call('bash', { command }, `${exit === 0 ? '' : 'Error: '}[stdout]\nout\n[exit=${exit} 12ms]`);
const edit = (path = 'a.ts'): ChatMessage[] => call('str_replace_editor', { command: 'str_replace', path, old_str: 'a', new_str: 'b' }, `치환 완료: ${path}`);

describe('셸 명령 분류', () => {
    it.each([
        'ls -la', 'cat a.txt | head -20', 'git status', 'git diff HEAD~1', 'grep -rn foo src; wc -l a.txt',
        'cd src && ls', 'find . -name "*.ts"', 'sed -n 1,20p a.ts', 'echo hi', 'cat a.txt 2>/dev/null',
    ])('읽기만 하는 명령: %s', (cmd) => expect(classifyShellCommand(cmd)).toBe('read'));

    it.each([
        'npm test', 'CI=1 npm test', 'cd app && npm run build', 'npx jest src/a.test.ts', 'python3 -m pytest -q',
        'pytest', 'go test ./...', 'cargo test', 'npx tsc --noEmit', 'npm run build && npm test', 'npm test 2>&1',
    ])('검증 명령: %s', (cmd) => expect(classifyShellCommand(cmd)).toBe('verify'));

    it.each([
        'npm test | tail -20', 'npm test || true', 'npm test; echo done',
    ])('종료 코드가 가려지는 검증 명령은 증거로 치지 않는다(변경도 아니다): %s', (cmd) => expect(classifyShellCommand(cmd)).toBe('read'));

    it.each([
        'rm -rf dist', "sed -i 's/a/b/' a.ts", 'echo hi > a.txt', 'cat a >> b', 'npm install', 'git checkout .',
        'find . -name "*.tmp" -delete', 'python3 gen.py', 'ls && touch x', 'echo $(rm x)', 'npm test && rm -rf dist', 'mv a b',
    ])('그 밖은 파일을 바꿨을 수 있다고 본다: %s', (cmd) => expect(classifyShellCommand(cmd)).toBe('mutate'));
});

describe('검증 증거 원장', () => {
    it('읽기만 한 작업은 변경 흔적이 없다', () => {
        const conv = [...bash('ls'), ...call('str_replace_editor', { command: 'view', path: 'a.ts' }, 'x'), ...call('file_ops', { op: 'read', path: 'a.ts' }, 'x')];
        expect(collectVerificationEvidence(conv)).toEqual({ mutated: false, freshPass: null });
    });

    it('편집 뒤 테스트가 성공했으면 새 증거다', () => {
        const conv = [...edit(), ...bash('npm test')];
        expect(collectVerificationEvidence(conv)).toEqual({ mutated: true, freshPass: 'npm test' });
    });

    it('테스트 뒤에 다시 편집했으면 증거는 낡았다', () => {
        const conv = [...edit(), ...bash('npm test'), ...edit('b.ts')];
        expect(collectVerificationEvidence(conv)).toEqual({ mutated: true, freshPass: null });
    });

    it('테스트 뒤에 읽기만 했으면 증거는 그대로다', () => {
        const conv = [...edit(), ...bash('npm test'), ...bash('git status'), ...call('grep_code', { pattern: 'x' }, '(일치 없음: x)')];
        expect(collectVerificationEvidence(conv).freshPass).toBe('npm test');
    });

    it('실패한 테스트는 증거가 아니고, 성공 뒤의 실패는 앞의 증거를 지운다', () => {
        expect(collectVerificationEvidence([...edit(), ...bash('npm test', 1)]).freshPass).toBeNull();
        expect(collectVerificationEvidence([...edit(), ...bash('npm test'), ...bash('npm run build', 2)]).freshPass).toBeNull();
    });

    it('시간 초과·접힌 결과는 증거가 아니다', () => {
        const timedOut = call('bash', { command: 'npm test' }, 'Error: [exit=0 TIMEOUT 600000ms]');
        const folded = call('bash', { command: 'npm test' }, '[접힌 도구 결과] bash 결과 9000자 — 이미 읽고 처리한 내용이라 앞부분만 남김.\n[stdout]\nPASS');
        expect(collectVerificationEvidence([...edit(), ...timedOut]).freshPass).toBeNull();
        expect(collectVerificationEvidence([...edit(), ...folded]).freshPass).toBeNull();
    });

    it('실패한 편집은 변경이 아니다', () => {
        const conv = call('str_replace_editor', { command: 'str_replace', path: 'a.ts', old_str: 'a', new_str: 'b' }, 'Error: old_str 를 찾을 수 없습니다');
        expect(collectVerificationEvidence(conv).mutated).toBe(false);
    });

    it('코드 실행·셸의 알 수 없는 명령은 변경으로 본다', () => {
        expect(collectVerificationEvidence(call('python_execute', { code: 'print(1)' }, '[exit=0 1ms]')).mutated).toBe(true);
        expect(collectVerificationEvidence(bash('make all')).mutated).toBe(true);
        expect(collectVerificationEvidence([...bash('npm test'), ...bash('npm install')])).toEqual({ mutated: true, freshPass: null });
    });

    it('기록에서 호출을 하나도 읽지 못하면 변경이 있었다고 본다(검증하는 쪽)', () => {
        expect(collectVerificationEvidence([{ role: 'user', content: 'hi' } as ChatMessage])).toEqual({ mutated: true, freshPass: null });
    });
});
