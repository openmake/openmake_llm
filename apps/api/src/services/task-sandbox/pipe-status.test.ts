import { wrapPipeline, readPipeStatus, maskedPipeFailureNote } from './pipe-status';
import type { ExecResult } from './executor';

const TAG = '__omk_ps_abcd1234';
const res = (over: Partial<ExecResult> = {}): ExecResult => ({ stdout: '', stderr: '', exitCode: 0, truncated: false, timedOut: false, durationMs: 1, ...over });

describe('파이프라인 단계별 종료 코드 — 명령 감싸기', () => {
    it('마지막 명령을 뺀 각 단계가 자기 종료 코드를 stderr 로 적게 감싼다', () => {
        const w = wrapPipeline('npm test | tail -5', TAG, true);
        expect(w?.command).toBe(`{ npm test ; printf '%s\\n' "${TAG}:1:$?" >&2; }| tail -5`);
        expect(w?.stages).toEqual(['npm test']);
    });

    it('앞에 이어 붙인 명령(cd·환경변수)은 그대로 두고 마지막 파이프라인만 감싼다', () => {
        const w = wrapPipeline('cd app && FOO=1 pytest 2>&1 | head', TAG, true);
        expect(w?.command.startsWith('cd app &&{  FOO=1 pytest 2>&1 ; printf')).toBe(true);
        expect(w?.command.endsWith('}| head')).toBe(true);
        expect(w?.stages).toEqual(['FOO=1 pytest 2>&1']);
    });

    it('세 단계면 앞의 두 단계를 감싼다', () => {
        const w = wrapPipeline('cat f | grep x | wc -l', TAG, true);
        expect(w?.stages).toEqual(['cat f', 'grep x']);
        expect(w?.command).toContain(`"${TAG}:2:$?"`);
        expect(w?.command.endsWith('| wc -l')).toBe(true);
    });

    it('따옴표 안의 연산자는 연산자로 보지 않는다', () => {
        expect(wrapPipeline(`echo 'a | b; c' | wc -c`, TAG, true)?.stages).toEqual([`echo 'a | b; c'`]);
        expect(wrapPipeline(`echo "a && b | c"`, TAG, true)).toBeNull();
    });

    it('끝의 ; 는 남긴다', () => {
        expect(wrapPipeline('a | b;', TAG, true)?.command.endsWith('| b;')).toBe(true);
    });

    it('파이프가 없으면 감싸지 않는다', () => {
        for (const c of ['ls -la', 'cd a && npm test', 'a || b', 'false | true; echo done', 'echo x > f 2>&1']) {
            expect(wrapPipeline(c, TAG, true)).toBeNull();
        }
    });

    it('안전하게 가를 수 없는 형태는 감싸지 않는다', () => {
        const unsafe = [
            'a | b\nc | d',                         // 여러 줄 스크립트
            'cat <<EOF | wc\nhi\nEOF',              // here-doc
            'sleep 5 | cat &',                      // 백그라운드
            'a |& b',
            'echo $(ls | wc -l) | cat',             // 명령 치환
            'echo `ls` | cat',
            '(a | b)',                              // 서브셸
            'f() { a | b; }',
            'if a | b; then c; fi',                 // 복합 명령
            'for f in x; do a | b; done',
            'while read l; do echo $l; done < f | wc -l',
            '! a | b',
            'time a | b',
            'exec 2>log; a | b',                    // stderr 를 통째로 돌린 경우
            'a | b # c | d',                        // 주석
            `echo 'abc | wc`,                       // 닫히지 않은 따옴표
            'a | b \\',                             // 줄 잇기
            'a | | b',
            'a >| f | b;;',
        ];
        for (const c of unsafe) expect(wrapPipeline(c, TAG, true)).toBeNull();
    });

    it('꺼져 있으면 감싸지 않는다', () => {
        expect(wrapPipeline('npm test | tail -5', TAG, false)).toBeNull();
    });
});

describe('파이프라인 단계별 종료 코드 — 결과 읽기', () => {
    const wrapped = { command: '', tag: TAG, stages: ['npm test'] };

    it('표식 줄을 stderr 에서 지우고 단계별 코드를 싣는다', () => {
        const r = readPipeStatus(res({ stderr: `warn: x\n${TAG}:1:2\n` }), wrapped);
        expect(r.stderr).toBe('warn: x\n');
        expect(r.pipeStages).toEqual([{ index: 1, command: 'npm test', exitCode: 2 }]);
    });

    it('표식이 없으면(출력이 잘렸거나 단계가 죽었으면) 단계 정보를 싣지 않는다', () => {
        const r = readPipeStatus(res({ stderr: 'x' }), wrapped);
        expect(r.stderr).toBe('x');
        expect(r.pipeStages).toEqual([]);
    });
});

describe('파이프에 가려진 실패 경고', () => {
    const stage = (command: string, exitCode: number, index = 1) => ({ index, command, exitCode });

    it('전체는 0 인데 앞 단계가 0 이 아니면 한 줄로 알린다', () => {
        const note = maskedPipeFailureNote(res({ pipeStages: [stage('npm test', 1)] }));
        expect(note).toContain('1번째');
        expect(note).toContain('npm test');
        expect(note).toContain('종료 코드 1');
        expect(note?.includes('\n')).toBe(false);
    });

    it('앞 단계가 모두 0 이면 알리지 않는다', () => {
        expect(maskedPipeFailureNote(res({ pipeStages: [stage('npm test', 0)] }))).toBeNull();
    });

    it('전체 종료 코드가 0 이 아니면 알리지 않는다 — 이미 실패로 보인다', () => {
        expect(maskedPipeFailureNote(res({ exitCode: 1, pipeStages: [stage('npm test', 1)] }))).toBeNull();
    });

    it('실패가 아닌 종료 코드(grep 1 = 일치 없음)는 알리지 않는다', () => {
        expect(maskedPipeFailureNote(res({ pipeStages: [stage('cat f', 0, 1), stage('grep x', 1, 2)] }))).toBeNull();
        expect(maskedPipeFailureNote(res({ pipeStages: [stage('grep x f', 2)] }))).toContain('종료 코드 2');
    });

    it('뒤 명령이 먼저 닫아 SIGPIPE 로 끝난 것(141)은 알리지 않는다', () => {
        expect(maskedPipeFailureNote(res({ pipeStages: [stage('yes', 141)] }))).toBeNull();
    });

    it('단계 정보가 없거나 시간 초과면 알리지 않는다', () => {
        expect(maskedPipeFailureNote(res())).toBeNull();
        expect(maskedPipeFailureNote(res({ timedOut: true, pipeStages: [stage('npm test', 1)] }))).toBeNull();
    });
});
