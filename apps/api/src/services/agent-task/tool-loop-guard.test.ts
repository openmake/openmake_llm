import { priorRepetition, repetitionVerdict, cycleVerdict, rereadNote, retryAfterUnknownOutcome, sameErrorVerdict } from './tool-loop-guard';
import {
    getLocalBridgeUnknownOutcomeNotice, getAgentTaskUnknownOutcomeDeclinedNotice,
    getToolLoopBlockedResult, getToolLoopSameErrorBlockedResult, getToolLoopSameErrorNote, isToolLoopBlockedResult,
} from '../../prompts/agent-task-prompt';
import { getDuplicateToolCallResult, getToolLoopCycleBlockedResult, getMalformedToolArgsResult } from '../../prompts/agent-task-turn-loop';
import { getApprovalRejectedNotice } from '../../prompts/agent-task-approval';
import { getSubagentApprovalRequiredNotice } from '../../prompts/subagent-system';
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

    it('출처 태그가 붙은 래퍼(<tool_output tool="…">)에 싸인 오류도 실패로 본다', () => {
        const conv = base();
        round(conv, 'web_search', { query: 'x' }, '<tool_output tool="web_search">\nError: timeout\n</tool_output>\n목표: ...');
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

    it('출처 태그 래퍼에 싸인 중복 호출 안내도 반복 집계에서 뺀다', () => {
        const conv = base();
        round(conv, 'web_search', { query: 'x' }, '결과 A');
        round(conv, 'web_search', { query: 'x' }, `<tool_output tool="web_search">\n${getDuplicateToolCallResult('web_search', 'c0')}\n</tool_output>`);
        round(conv, 'web_search', { query: 'x' }, '결과 A');
        expect(priorRepetition(conv, 'web_search', { query: 'x' })).toEqual(expect.objectContaining({ sameResult: 2, lastResult: '결과 A' }));
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

describe('retryAfterUnknownOutcome — 결과 불명으로 끝난 쓰기를 다시 하려는가', () => {
    const unknown = getLocalBridgeUnknownOutcomeNotice('browser', 'disconnected');
    const submit = { actions: [{ type: 'goto', url: 'https://a.example/form' }, { type: 'fill', selector: '#name', text: '홍길동' }, { type: 'click', selector: '#submit' }] };

    it('같은 호출의 마지막 결과가 결과 불명이면 참 — 사이에 상태 확인이 끼어도', () => {
        const conv = base();
        round(conv, 'browser', submit, unknown);
        round(conv, 'browser', { actions: [{ type: 'snapshot' }] }, 'about:blank');
        expect(retryAfterUnknownOutcome(conv, 'browser', submit)).toBe('ask');
    });

    it('브라우저는 쓰기 액션이 같으면 같은 호출이다 — 읽기 액션을 덧붙여도 참', () => {
        const conv = base();
        round(conv, 'browser', submit, `<tool_output>${unknown}</tool_output>`);
        expect(retryAfterUnknownOutcome(conv, 'browser', { actions: [...submit.actions, { type: 'screenshot' }] })).toBe('ask');
    });

    it('호출을 쪼개 일부 쓰기만 다시 해도 참 — 액션 단위로 본다', () => {
        const conv = base();
        round(conv, 'browser', submit, unknown);
        expect(retryAfterUnknownOutcome(conv, 'browser', { actions: [submit.actions[0], submit.actions[1]] })).toBe('ask');
        expect(retryAfterUnknownOutcome(conv, 'browser', { actions: [submit.actions[2]] })).toBe('ask');
    });

    it('주소 이동·읽기만 다시 하는 것은 거짓(되풀이해도 해가 없다)', () => {
        const conv = base();
        round(conv, 'browser', submit, unknown);
        expect(retryAfterUnknownOutcome(conv, 'browser', { actions: [submit.actions[0], { type: 'snapshot' }] })).toBeNull();
    });

    it('쓰기 내용이 다르면 거짓', () => {
        const conv = base();
        round(conv, 'browser', submit, unknown);
        expect(retryAfterUnknownOutcome(conv, 'browser', { actions: [{ type: 'fill', selector: '#name', text: '다른 값' }] })).toBeNull();
    });

    it('그 뒤에 같은 호출이 정상으로 끝났으면 거짓(한 번 물은 뒤에는 다시 묻지 않는다)', () => {
        const conv = base();
        round(conv, 'browser', submit, unknown);
        round(conv, 'browser', submit, '{"ok":true}');
        expect(retryAfterUnknownOutcome(conv, 'browser', submit)).toBeNull();
    });

    it('사용자가 다시 실행하지 않기로 한 뒤 같은 쓰기를 또 하려 하면 declined — 다시 묻지 않고 막는다', () => {
        const conv = base();
        round(conv, 'browser', submit, unknown);
        round(conv, 'browser', submit, getAgentTaskUnknownOutcomeDeclinedNotice('browser', 'device'));
        expect(retryAfterUnknownOutcome(conv, 'browser', submit)).toBe('declined');
        expect(retryAfterUnknownOutcome(conv, 'browser', { actions: [submit.actions[1]] })).toBe('declined');
    });

    it('브라우저가 아닌 도구는 이름·인자가 같아야 한다', () => {
        const conv = base();
        round(conv, 'file_ops', { op: 'write', path: 'a.txt', content: 'x' }, unknown);
        expect(retryAfterUnknownOutcome(conv, 'file_ops', { op: 'write', path: 'a.txt', content: 'x' })).toBe('ask');
        expect(retryAfterUnknownOutcome(conv, 'file_ops', { op: 'write', path: 'b.txt', content: 'x' })).toBeNull();
    });
});

describe('isToolLoopBlockedResult — 가드가 실행하지 않고 돌려준 결과', () => {
    it('기존 차단 3종과 같은 오류 차단을 모두 알아본다(래퍼에 싸여 있어도)', () => {
        for (const r of [
            getToolLoopBlockedResult('bash', 4, 'failure'),
            getToolLoopBlockedResult('grep_code', 5, 'same_result'),
            getToolLoopCycleBlockedResult('bash', 2, 3),
            getToolLoopSameErrorBlockedResult('grep_code', 6, '정규식이 올바르지 않습니다: x'),
        ]) {
            expect(isToolLoopBlockedResult(r)).toBe(true);
            expect(isToolLoopBlockedResult(`<tool_output tool="x">\n${r}\n</tool_output>\n목표: g`)).toBe(true);
        }
    });

    it('실행한 도구의 오류는 차단 결과가 아니다', () => {
        expect(isToolLoopBlockedResult('Error: 정규식이 올바르지 않습니다: Invalid group modifier')).toBe(false);
        expect(isToolLoopBlockedResult('Error: 이 호출은 실패했습니다')).toBe(false);
    });

    it('꼴이 비슷한 승인 거절·깨진 인자 문구는 가드 차단이 아니다(래퍼에 싸여 있어도)', () => {
        for (const r of [
            getApprovalRejectedNotice('bash', 'unattended'),
            getSubagentApprovalRequiredNotice('bash'),
            getMalformedToolArgsResult('bash'),
        ]) {
            expect(isToolLoopBlockedResult(r)).toBe(false);
            expect(isToolLoopBlockedResult(`<tool_output tool="x">\n${r}\n</tool_output>\n목표: g`)).toBe(false);
        }
    });
});

describe('sameErrorVerdict — 인자를 바꿔도 같은 오류로 연속 실패', () => {
    const ERR = 'Error: 정규식이 올바르지 않습니다: Invalid group modifier';
    const sameErrLimits = { warn: 3, block: 6, excerptMaxChars: 200 };
    /** 같은 도구(grep_code)를 인자만 바꿔 n번 같은 오류로 실패시킨 대화. */
    const failing = (n: number, conv = base(), result = ERR): ChatMessage[] => {
        for (let i = 0; i < n; i++) round(conv, 'grep_code', { pattern: `(?-u:a${seq})` }, result);
        return conv;
    };
    const verdict = (conv: ChatMessage[]) => sameErrorVerdict(conv, 'grep_code', sameErrLimits);

    it('세 번째로 같은 오류가 나면 결과 뒤에 한 줄 안내를 붙인다', () => {
        expect(verdict(failing(1)).noteFor(ERR)).toBe('');
        const note = verdict(failing(2)).noteFor(ERR);
        expect(note).toBe(getToolLoopSameErrorNote(3));
        expect(note).toContain('[반복 안내]');
        expect(note).toContain('인자를 바꿔도');
        expect(note.trim().split('\n')).toHaveLength(1);
        expect(verdict(failing(2)).noteFor('Error: 다른 오류')).toBe('');
        expect(verdict(failing(2)).noteFor('a.ts:1:a')).toBe('');
    });

    it('같은 오류가 여섯 번 이어지면 다음 호출은 실행하지 않고 마지막 오류의 첫 줄을 싣는다', () => {
        expect(verdict(failing(5)).block).toBe(false);
        const v = verdict(failing(6, base(), `${ERR}\n(힌트 줄)`));
        expect(v.block).toBe(true);
        expect(v.blockedResult).toBe(getToolLoopSameErrorBlockedResult('grep_code', 6, '정규식이 올바르지 않습니다: Invalid group modifier'));
        expect(v.blockedResult).toMatch(/^Error: 이 호출\(grep_code\)은 인자를 바꿔도 같은 오류로 6번 연속 실패해 실행하지 않았습니다/);
        expect(v.blockedResult).not.toContain('힌트 줄');
    });

    it('마지막 오류 발췌는 설정 글자 수에서 자른다', () => {
        const long = `Error: ${'x'.repeat(500)}`;
        const v = sameErrorVerdict(failing(6, base(), long), 'grep_code', { ...sameErrLimits, excerptMaxChars: 50 });
        expect(v.blockedResult).toContain(`${'x'.repeat(50)}…`);
        expect(v.blockedResult).not.toContain('x'.repeat(51));
    });

    it('차단 직후에는 한 번 실행한다(탐침) — 그것도 같은 오류면 다음 호출은 다시 막는다', () => {
        const conv = failing(6);
        round(conv, 'grep_code', { pattern: 'p7' }, verdict(conv).blockedResult);
        expect(verdict(conv).block).toBe(false);
        expect(verdict(conv).noteFor(ERR)).toBe(getToolLoopSameErrorNote(7));
        round(conv, 'grep_code', { pattern: 'p8' }, ERR);
        expect(verdict(conv).block).toBe(true);
    });

    it('오류 문구가 다르거나 성공 결과가 끼면 다시 센다', () => {
        const diff = failing(5);
        round(diff, 'grep_code', { pattern: 'q' }, 'Error: 다른 오류');
        expect(verdict(diff).block).toBe(false);
        expect(verdict(diff).noteFor('Error: 다른 오류')).toBe('');
        const ok = failing(5);
        round(ok, 'grep_code', { pattern: 'a' }, 'a.ts:1:a');
        failing(2, ok);
        expect(verdict(ok).block).toBe(false);
        expect(verdict(ok).noteFor(ERR)).toBe(getToolLoopSameErrorNote(3));
    });

    it('다른 도구의 호출은 건너뛴다(사이에 bash 가 끼어도 이어서 센다)', () => {
        const conv = base();
        for (let i = 0; i < 6; i++) {
            round(conv, 'grep_code', { pattern: `p${i}` }, ERR);
            if (i % 2 === 0) round(conv, 'bash', { command: `ls ${i}` }, '[stdout]\na\n[exit=0 1ms]');
        }
        expect(verdict(conv).block).toBe(true);
        expect(sameErrorVerdict(conv, 'bash', sameErrLimits).block).toBe(false);
    });

    it('기존 가드의 차단 결과는 실행 결과가 아니어서 건너뛴다', () => {
        const conv = failing(3);
        round(conv, 'grep_code', { pattern: 'same' }, getToolLoopBlockedResult('grep_code', 4, 'failure'));
        round(conv, 'grep_code', { pattern: 'c' }, getToolLoopCycleBlockedResult('grep_code', 2, 3));
        failing(3, conv);
        expect(verdict(conv).block).toBe(true);
    });

    it('무인 실행 승인 거절은 보통의 오류 결과로 센다 — 같은 오류 사이에 끼면 연속이 끊긴다', () => {
        const unattended = getApprovalRejectedNotice('grep_code', 'unattended');
        const conv = failing(6);
        round(conv, 'grep_code', { pattern: 'u' }, unattended);
        const v = verdict(conv);
        expect(v.block).toBe(false);
        expect(v.noteFor(ERR)).toBe('');
        expect(v.blockedResult).not.toContain('정규식이 올바르지 않습니다');
    });

    it('무인 실행 승인 거절만 여섯 번 이어지면 일곱 번째는 같은 오류 차단이다', () => {
        const unattended = getApprovalRejectedNotice('grep_code', 'unattended');
        expect(verdict(failing(5, base(), unattended)).block).toBe(false);
        const v = verdict(failing(6, base(), unattended));
        expect(v.block).toBe(true);
        expect(v.blockedResult).toMatch(/^Error: 이 호출\(grep_code\)은 인자를 바꿔도 같은 오류로 6번 연속 실패해 실행하지 않았습니다/);
        expect(v.blockedResult).toContain('(마지막 오류: 이 호출(grep_code)은 승인이 필요한데');
    });

    it('반복 안내 줄이 붙은 앞 결과도 같은 오류로 센다', () => {
        const conv = failing(1);
        round(conv, 'grep_code', { pattern: 'b' }, `${ERR}\n\n[반복 안내] 같은 인자의 같은 호출이 2번 연속 실패했습니다.`);
        expect(verdict(conv).noteFor(ERR)).toBe(getToolLoopSameErrorNote(3));
    });

    it('데이터 래퍼(<tool_output>)에 싸인 결과도 같은 오류로 센다', () => {
        const wrapped = `<tool_output tool="grep_code">\n${ERR}\n</tool_output>\n목표: g`;
        const conv = failing(6, base(), wrapped);
        const v = verdict(conv);
        expect(v.block).toBe(true);
        expect(v.blockedResult).toContain('(마지막 오류: 정규식이 올바르지 않습니다: Invalid group modifier)');
        expect(verdict(failing(2, base(), wrapped)).noteFor(wrapped)).toBe(getToolLoopSameErrorNote(3));
    });
});
