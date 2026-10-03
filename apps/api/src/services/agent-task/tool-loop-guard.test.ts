import { priorRepetition, repetitionVerdict, cycleVerdict, rereadNote } from './tool-loop-guard';
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

describe('priorRepetition — 결과 뒤에 붙은 반복 안내', () => {
    it('안내가 붙은 앞선 결과도 같은 결과로 센다(안내 문구는 비교에서 뺀다)', () => {
        const conv = base();
        round(conv, 'file_ops', { op: 'read', path: 'a.txt' }, '내용');
        round(conv, 'file_ops', { op: 'read', path: 'a.txt' }, '내용\n\n[반복 안내] 이미 읽은 구간입니다.');
        round(conv, 'file_ops', { op: 'read', path: 'a.txt' }, '내용\n\n[반복 안내] 이 호출은 3번 연속 같은 결과를 돌려줬습니다.');
        expect(priorRepetition(conv, 'file_ops', { op: 'read', path: 'a.txt' })).toEqual(expect.objectContaining({ sameResult: 3, lastResult: '내용' }));
    });
});

describe('cycleVerdict — 서로 다른 호출이 번갈아 되풀이되는 주기', () => {
    const A = { command: 'python report.py' };
    const B = { command: 'pip install corp_metrics' };
    /** A-B 를 laps 바퀴 돈 대화. */
    const abab = (laps: number): ChatMessage[] => {
        const conv = base();
        for (let i = 0; i < laps; i++) { round(conv, 'bash', A, 'Error: no module'); round(conv, 'bash', B, 'Error: no network'); }
        return conv;
    };

    it('A-B-A-B: 두 번째 바퀴가 같은 결과로 끝나면 안내한다', () => {
        const conv = abab(1);
        round(conv, 'bash', A, 'Error: no module');
        const v = cycleVerdict(conv, 'bash', B);
        expect(v.block).toBe(false);
        expect(v.noteFor('Error: no network')).toContain('[반복 안내]');
        expect(v.noteFor('Error: no network')).toContain('2개');
        expect(v.noteFor('[stdout]\ninstalled\n[exit=0 3ms]')).toBe('');
    });

    it('첫 바퀴에서는 안내하지 않는다', () => {
        const conv = base();
        round(conv, 'bash', A, 'Error: no module');
        expect(cycleVerdict(conv, 'bash', B).noteFor('Error: no network')).toBe('');
        expect(cycleVerdict(abab(1), 'bash', A).noteFor('Error: no module')).toBe('');
    });

    it('A-B-C-A-B-C: 세 호출 주기도 잡는다', () => {
        const conv = base();
        const C = { command: 'ls' };
        for (const [args, out] of [[A, 'ra'], [B, 'rb'], [C, 'rc'], [A, 'ra'], [B, 'rb']] as const) round(conv, 'bash', args, out);
        const v = cycleVerdict(conv, 'bash', C);
        expect(v.noteFor('rc')).toContain('3개');
    });

    it('차단 임계만큼 바퀴를 돈 뒤 같은 주기를 이어가는 호출은 실행하지 않는다', () => {
        expect(cycleVerdict(abab(3), 'bash', A).block).toBe(false);
        const conv = abab(3);
        round(conv, 'bash', A, 'Error: no module');
        const v = cycleVerdict(conv, 'bash', B);
        expect(v.block).toBe(true);
        expect(v.blockedResult).toMatch(/^Error:/);
        // 주기 밖의 다른 호출은 막지 않는다
        expect(cycleVerdict(conv, 'bash', { command: 'cat report.py' }).block).toBe(false);
    });

    it('반례 — 편집 → 테스트 → 편집 → 테스트에서 테스트 결과가 달라지면 걸리지 않는다', () => {
        const conv = base();
        const edit = { command: 'create', path: 'a.py', file_text: 'x' };
        const test = { command: 'pytest -q' };
        for (let i = 0; i < 4; i++) {
            round(conv, 'str_replace_editor', edit, 'File created: a.py');
            round(conv, 'bash', test, `[stdout]\n${3 - i} failed\n[exit=1 ${i}ms]`);
        }
        round(conv, 'str_replace_editor', edit, 'File created: a.py');
        const v = cycleVerdict(conv, 'bash', test);
        expect(v.block).toBe(false);
        expect(v.noteFor('[stdout]\n0 failed\n[exit=0 1ms]')).toBe('');
        expect(cycleVerdict(conv.slice(0, -2), 'str_replace_editor', edit).block).toBe(false);
    });

    it('반례 — 인자가 달라지는 번갈아 호출(다른 파일 편집 → 같은 테스트)은 주기가 아니다', () => {
        const conv = base();
        for (let i = 0; i < 4; i++) {
            round(conv, 'str_replace_editor', { command: 'create', path: `f${i}.py`, file_text: 'x' }, 'ok');
            round(conv, 'bash', { command: 'pytest -q' }, 'same output');
        }
        round(conv, 'str_replace_editor', { command: 'create', path: 'f9.py', file_text: 'x' }, 'ok');
        const v = cycleVerdict(conv, 'bash', { command: 'pytest -q' });
        expect(v.block).toBe(false);
        expect(v.noteFor('same output')).toBe('');
    });

    it('같은 호출 하나의 연속 반복은 주기로 세지 않는다(기존 가드 몫)', () => {
        const conv = base();
        for (let i = 0; i < 6; i++) round(conv, 'bash', A, 'Error: no module');
        const v = cycleVerdict(conv, 'bash', A);
        expect(v.block).toBe(false);
        expect(v.noteFor('Error: no module')).toBe('');
    });

    it('앞선 결과에 안내가 붙어 있어도 주기를 이어서 센다', () => {
        const conv = abab(1);
        round(conv, 'bash', A, 'Error: no module');
        round(conv, 'bash', B, `Error: no network${cycleVerdict(conv, 'bash', B).noteFor('Error: no network')}`);
        round(conv, 'bash', A, 'Error: no module\n\n[반복 안내] x');
        expect(cycleVerdict(conv, 'bash', B).noteFor('Error: no network')).toContain('3바퀴');
    });
});

describe('rereadNote — 바뀌지 않은 같은 파일·같은 구간 다시 읽기', () => {
    const view = { command: 'view', path: 'uploads/server.log', start_line: 1, line_count: 100 };

    it('두 번째로 읽으면 바로 안내한다', () => {
        const conv = base();
        round(conv, 'str_replace_editor', view, '[줄 1-100]\n내용');
        const note = rereadNote(conv, 'str_replace_editor', view, '[줄 1-100]\n내용');
        expect(note).toContain('[반복 안내]');
        expect(note).toContain('이미 읽은');
        expect(note.trim().split('\n')).toHaveLength(1);
    });

    it('사이에 읽기 호출만 있었으면 안내한다', () => {
        const conv = base();
        round(conv, 'str_replace_editor', view, '내용');
        round(conv, 'grep_code', { pattern: 'ERROR' }, 'hit');
        round(conv, 'str_replace_editor', { ...view, start_line: 101 }, '다른 구간');
        expect(rereadNote(conv, 'str_replace_editor', view, '내용')).not.toBe('');
    });

    it('처음 읽거나 구간이 다르면 안내하지 않는다', () => {
        const conv = base();
        expect(rereadNote(conv, 'str_replace_editor', view, '내용')).toBe('');
        round(conv, 'str_replace_editor', view, '내용');
        expect(rereadNote(conv, 'str_replace_editor', { ...view, start_line: 101 }, '다음 구간')).toBe('');
        expect(rereadNote(conv, 'str_replace_editor', { ...view, path: 'uploads/other.log' }, '내용')).toBe('');
    });

    it('그 사이에 파일을 고칠 수 있는 호출(편집·bash)이 있었으면 안내하지 않는다', () => {
        for (const [name, args] of [
            ['str_replace_editor', { command: 'str_replace', path: 'uploads/server.log', old_str: 'a', new_str: 'b' }],
            ['bash', { command: 'sed -i s/a/b/ uploads/server.log' }],
        ] as const) {
            const conv = base();
            round(conv, 'str_replace_editor', view, '내용');
            round(conv, name, args, 'ok');
            expect(rereadNote(conv, 'str_replace_editor', view, '내용')).toBe('');
        }
    });

    it('내용이 달라졌거나, 앞선 결과가 접혀 모델이 볼 수 없거나, 이번 읽기가 실패면 안내하지 않는다', () => {
        const conv = base();
        round(conv, 'str_replace_editor', view, '내용');
        expect(rereadNote(conv, 'str_replace_editor', view, '바뀐 내용')).toBe('');
        expect(rereadNote(conv, 'str_replace_editor', view, 'Error: 파일이 없습니다')).toBe('');
        const folded = base();
        round(folded, 'str_replace_editor', view, '[접힘] 앞부분만…');
        expect(rereadNote(folded, 'str_replace_editor', view, '내용')).toBe('');
    });

    it('보기가 아닌 호출에는 붙이지 않는다', () => {
        const conv = base();
        round(conv, 'bash', { command: 'cat a' }, '내용');
        expect(rereadNote(conv, 'bash', { command: 'cat a' }, '내용')).toBe('');
    });
});
