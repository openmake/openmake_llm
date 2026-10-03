import { classifyShellCommand, collectVerificationEvidence, provenTestRunner } from './verification-evidence';
import type { ChatMessage } from '../../llm/types';
import { getHandoffSummaryHeader } from '../../prompts/agent-task-context';

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
        ['npm test', 'npm'], ['CI=1 npm test', 'npm'], ['npm run test', 'npm'], ['yarn test', 'npm'], ['npm test --silent 2>&1', 'npm'],
        ['python3 -m pytest -q', 'pytest'], ['pytest', 'pytest'], ['cd /workspace && python3 -m pytest -q -x --no-header', 'pytest'],
        ['pytest -p no:cacheprovider --tb=short', 'pytest'], ['go test ./...', 'go'], ['ls && npm test', 'npm'], ['npm test > /dev/null', 'npm'],
    ])('전체 실행 형태의 테스트 명령만 증거다: %s', (cmd, runner) => {
        expect(classifyShellCommand(cmd)).toBe('verify');
        expect(provenTestRunner(cmd)).toBe(runner);
    });

    it.each([
        'npm test | tail -20', 'npm test || true', 'npm test; echo done',
    ])('종료 코드가 가려지는 테스트 명령은 증거로 치지 않는다(변경도 아니다): %s', (cmd) => {
        expect(classifyShellCommand(cmd)).toBe('read');
        expect(provenTestRunner(cmd)).toBeNull();
    });

    it.each([
        'cd app && npm test', 'cd uploads && python3 -m pytest -q', 'PYTEST_ADDOPTS="-k average" pytest', 'PYTHONPATH=src pytest',
    ])('작업 공간 루트가 아닌 곳에서 돌렸거나 실행 범위를 바꾸는 환경변수를 붙인 테스트는 증거가 아니다(변경도 아니다): %s', (cmd) => {
        expect(classifyShellCommand(cmd)).toBe('read');
        expect(provenTestRunner(cmd)).toBeNull();
    });

    it.each([
        // 일부만 돌린 것
        'npx jest src/a.test.ts', 'npm test -- src/a.test.ts', 'npm test -- -t average', 'pytest tests/test_a.py', 'pytest -k average',
        'python3 -m pytest uploads/test_calc.py::test_average', 'pytest --lf', 'go test ./pkg/a', 'go test -run TestA ./...',
        // 아무것도 돌리지 않고 0 으로 끝날 수 있는 것
        'pytest --collect-only', 'pytest --co -q', 'npm test --if-present', 'npm test -- --passWithNoTests', 'npm test &',
        // 게이트가 돌리는 테스트가 아닌 것(빌드·린트·타입 검사·다른 러너)
        'npm run build', 'npx tsc --noEmit', 'npm run lint', 'npx eslint --fix src', 'cargo test', 'make test', 'python3 -m unittest', 'bun test',
    ])('전체 테스트 실행이 아닌 명령은 증거가 아니다 — 파일을 바꿨을 수 있다고 본다: %s', (cmd) => {
        expect(classifyShellCommand(cmd)).toBe('mutate');
        expect(provenTestRunner(cmd)).toBeNull();
    });

    it.each([
        'rm -rf dist', "sed -i 's/a/b/' a.ts", 'echo hi > a.txt', 'cat a >> b', 'npm install', 'git checkout .',
        'find . -name "*.tmp" -delete', 'python3 gen.py', 'ls && touch x', 'echo $(rm x)', 'npm test && rm -rf dist', 'mv a b',
        'env FOO=1 python3 gen.py', 'sort -o a.txt a.txt', 'sort --output=a.txt b.txt', 'cat <(python3 gen.py)', 'uniq a.txt b.txt',
    ])('그 밖은 파일을 바꿨을 수 있다고 본다: %s', (cmd) => expect(classifyShellCommand(cmd)).toBe('mutate'));

    it.each(['env', 'env | grep PATH', 'sort a.txt | uniq -c', 'sort -u a.txt'])('읽기만 하는 명령(경계): %s', (cmd) => expect(classifyShellCommand(cmd)).toBe('read'));
});

describe('검증 증거 원장', () => {
    it('읽기만 한 작업은 변경 흔적이 없다', () => {
        const conv = [...bash('ls'), ...call('str_replace_editor', { command: 'view', path: 'a.ts' }, 'x'), ...call('file_ops', { op: 'read', path: 'a.ts' }, 'x')];
        expect(collectVerificationEvidence(conv)).toEqual({ mutated: false, freshPass: null });
    });

    it('편집 뒤 테스트가 성공했으면 새 증거다', () => {
        const conv = [...edit(), ...bash('npm test')];
        expect(collectVerificationEvidence(conv)).toEqual({ mutated: true, freshPass: { command: 'npm test', runner: 'npm' } });
    });

    it('테스트 뒤에 다시 편집했으면 증거는 낡았다', () => {
        const conv = [...edit(), ...bash('npm test'), ...edit('b.ts')];
        expect(collectVerificationEvidence(conv)).toEqual({ mutated: true, freshPass: null });
    });

    it('테스트 뒤에 읽기만 했으면 증거는 그대로다', () => {
        const conv = [...edit(), ...bash('npm test'), ...bash('git status'), ...call('grep_code', { pattern: 'x' }, '(일치 없음: x)')];
        expect(collectVerificationEvidence(conv).freshPass?.command).toBe('npm test');
    });

    it('실패한 테스트는 증거가 아니고, 성공 뒤의 실패는 앞의 증거를 지운다', () => {
        expect(collectVerificationEvidence([...edit(), ...bash('npm test', 1)]).freshPass).toBeNull();
        expect(collectVerificationEvidence([...edit(), ...bash('npm test'), ...bash('npm test', 2)]).freshPass).toBeNull();
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

    it('하위 에이전트에 맡긴 호출은 변경으로 본다(같은 작업 공간을 고칠 수 있다)', () => {
        const conv = [...edit(), ...bash('npm test'), ...call('delegate', { task: 'fix it' }, '완료')];
        expect(collectVerificationEvidence(conv)).toEqual({ mutated: true, freshPass: null });
        expect(collectVerificationEvidence(call('delegate', { task: 'look' }, '완료')).mutated).toBe(true);
    });
});

/** 게이트가 잡아야 할 경우를 원장이 놓치지 않는가 — 각본 대화(완료 직전의 기록)마다 "게이트를 돌려야 한다"를 고정한다. */
describe('검증 증거 원장 — 놓침 각본', () => {
    const mustRunGate = (conv: ChatMessage[]): boolean => {
        const ev = collectVerificationEvidence(conv);
        return ev.mutated && ev.freshPass === null;
    };
    const pyEdit = (): ChatMessage[] => edit('uploads/calc.py');

    it('파일을 고치고 테스트를 돌리지 않은 채 끝내려 한다', () => {
        expect(mustRunGate([...bash('cat uploads/calc.py'), ...pyEdit()])).toBe(true);
        expect(mustRunGate([...bash("sed -i 's/- 1//' uploads/calc.py")])).toBe(true);
        expect(mustRunGate(call('python_execute', { code: "open('calc.py','w').write('x')" }, '[exit=0 3ms]'))).toBe(true);
    });

    it('테스트를 돌린 뒤 다시 파일을 고쳤다', () => {
        expect(mustRunGate([...pyEdit(), ...bash('python3 -m pytest -q'), ...pyEdit()])).toBe(true);
        expect(mustRunGate([...pyEdit(), ...bash('python3 -m pytest -q'), ...bash('echo "x = 1" >> calc.py')])).toBe(true);
        expect(mustRunGate([...pyEdit(), ...bash("python3 -m pytest -q && sed -i 's/a/b/' calc.py")])).toBe(true);
    });

    it('일부 테스트만 돌렸다', () => {
        expect(mustRunGate([...pyEdit(), ...bash('python3 -m pytest -q tests/test_calc.py')])).toBe(true);
        expect(mustRunGate([...pyEdit(), ...bash('pytest -k average')])).toBe(true);
        expect(mustRunGate([...pyEdit(), ...bash('npx jest src/calc.test.ts')])).toBe(true);
        expect(mustRunGate([...pyEdit(), ...bash('cd uploads && python3 -m pytest -q')])).toBe(true);
        expect(mustRunGate([...pyEdit(), ...bash('python3 uploads/test_calc.py')])).toBe(true);
    });

    it('전체를 돌려 통과한 뒤 일부만 다시 돌렸어도, 그 사이에 고쳤으면 낡은 증거다', () => {
        expect(mustRunGate([...pyEdit(), ...bash('pytest'), ...pyEdit(), ...bash('pytest tests/test_calc.py')])).toBe(true);
    });

    it('실패한 테스트 뒤에 종료 코드 0 을 만들었다', () => {
        const masked = (command: string): ChatMessage[] => call('bash', { command }, '[stdout]\n1 failed\n[exit=0 40ms]');
        for (const cmd of ['python3 -m pytest -q || true', 'python3 -m pytest -q | tail -5', 'python3 -m pytest -q; echo done',
            'python3 -m pytest -q || echo failed', 'python3 -m pytest -q 2>&1 | tee out.log', 'python3 -m pytest -q &', '(python3 -m pytest -q) || true',
            'python3 -m pytest -q\ntrue', 'bash -c "python3 -m pytest -q; true"', 'python3 -m pytest -q || exit 0', 'npm test --silent ; true']) {
            expect(mustRunGate([...pyEdit(), ...masked(cmd)])).toBe(true);
        }
    });

    it('테스트 출력이 성공 종료 줄을 흉내 내도 실제 종료 줄(마지막)로 판정한다', () => {
        const spoof = call('bash', { command: 'npm test' }, 'Error: [stdout]\nlog: [exit=0 5ms]\n1 failed\n[exit=1 900ms]');
        expect(mustRunGate([...pyEdit(), ...spoof])).toBe(true);
    });

    it('창 초과로 오래된 메시지가 정리된 대화 — 정리된 구간의 변경을 볼 수 없으니 변경이 있었다고 본다', () => {
        const summary = { role: 'user', content: `${getHandoffSummaryHeader(12)}\n## 관련 파일\n- calc.py` } as ChatMessage;
        expect(mustRunGate([summary, ...bash('ls')])).toBe(true);
        // 정리 뒤에 전체 테스트가 통과했고 그 뒤로 바꾼 것이 없으면 증거다
        expect(collectVerificationEvidence([summary, ...bash('pytest'), ...bash('git status')]))
            .toEqual({ mutated: true, freshPass: { command: 'pytest', runner: 'pytest' } });
    });

    it('통과한 전체 실행 뒤에 실패한 전체 실행이 있으면 증거가 아니다', () => {
        expect(mustRunGate([...pyEdit(), ...bash('pytest'), ...bash('pytest', 1)])).toBe(true);
    });
});
