import { buildHandoffSummary, compactWithHandoff, isHandoffSummary } from './context-handoff';
import { foldOldToolResults } from './context-fold';
import type { ChatMessage } from '../../llm/types';

/** 메시지 하나를 글자 수로 세는 단순 추정기 — 테스트가 예산을 계산하기 쉽게 한다. */
const byChars = (msgs: ChatMessage[]): number => msgs.reduce((n, m) => n + m.content.length, 0);

function turn(t: number, name: string, args: Record<string, unknown>, result: string): ChatMessage[] {
    return [
        { role: 'assistant', content: '', tool_calls: [{ id: `c${t}`, type: 'function', function: { name, arguments: args } }] },
        { role: 'tool', content: result, tool_name: name, tool_call_id: `c${t}` },
    ];
}

function conv(): ChatMessage[] {
    return [
        { role: 'system', content: 'sys' },
        { role: 'user', content: '결제 모듈의 반올림 오류를 고쳐 주세요' },
        ...turn(0, 'bash', { command: 'npm test -- billing' }, `Error: [stderr]\n${'x'.repeat(400)}\nexpected 10.5 received 10.4\n[exit=1 900ms]`),
        ...turn(1, 'str_replace_editor', { command: 'view', path: 'src/billing/round.ts' }, 'v'.repeat(400)),
        ...turn(2, 'str_replace_editor', { command: 'str_replace', path: 'src/billing/round.ts' }, '치환 완료: src/billing/round.ts'),
        ...turn(3, 'bash', { command: 'npm test -- billing' }, `[stdout]\n${'o'.repeat(400)}\n[exit=0 800ms]`),
        ...turn(4, 'file_ops', { op: 'write', path: 'notes.md' }, '기록됨: notes.md'),
    ];
}

describe('buildHandoffSummary', () => {
    it('원래 요청·수행한 도구 호출·관련 파일·오류를 뽑는다', () => {
        const c = conv();
        const s = buildHandoffSummary(c.slice(2, 8), c[1].content);
        expect(isHandoffSummary(s)).toBe(true);
        expect(s).toContain('결제 모듈의 반올림 오류를 고쳐 주세요');
        expect(s).toContain('npm test -- billing');
        expect(s).toContain('view src/billing/round.ts');
        expect(s).toContain('str_replace src/billing/round.ts');
        expect(s).toContain('- src/billing/round.ts');
        expect(s).toContain('expected 10.5 received 10.4');
        // 파일 경로는 한 번만
        expect(s.split('- src/billing/round.ts').length - 1).toBe(1);
    });

    it('이미 접힌 스텁에서도 한 줄을 읽는다', () => {
        const c = conv();
        foldOldToolResults(c, { keepTurns: 1, minChars: 100, headChars: 40 });
        const s = buildHandoffSummary(c.slice(2, 8), c[1].content);
        expect(s).toContain('npm test -- billing');
        expect(s).toContain('expected 10.5 received 10.4');
        expect(s).not.toContain('이미 읽고 처리한');
    });

    it('앞선 인계 요약이 버려지는 구간에 있으면 그 목록을 이어받는다', () => {
        const c = conv();
        const first = buildHandoffSummary(c.slice(2, 6), c[1].content);
        const second = buildHandoffSummary([{ role: 'user', content: first }, ...c.slice(6, 10)], c[1].content);
        expect(second).toContain('view src/billing/round.ts');       // 첫 요약에서
        expect(second).toContain('str_replace src/billing/round.ts'); // 새 구간에서
        expect(second.split('[인계 요약]').length - 1).toBe(1);
        expect(second.split('expected 10.5 received 10.4').length - 1).toBeLessThanOrEqual(2); // 호출 목록 + 오류
    });
});

describe('compactWithHandoff', () => {
    it('예산을 넘으면 오래된 메시지를 요약 하나로 바꾸고 system·목표·최근 턴은 남긴다', () => {
        const c = conv();
        const before = c.length;
        const tail = c.slice(-2).map((m) => ({ ...m }));
        const r = compactWithHandoff(c, 900, byChars);
        expect(r.dropped).toBeGreaterThan(0);
        expect(c.length).toBeLessThan(before);
        expect(c[0].content).toBe('sys');
        expect(c[1].content).toContain('결제 모듈');
        expect(c[2].role).toBe('user');
        expect(isHandoffSummary(c[2].content)).toBe(true);
        expect(c.slice(-2)).toEqual(tail);
        // 남은 구간이 고아 tool 메시지로 시작하지 않는다
        expect(c[3].role).not.toBe('tool');
        // tool 메시지는 모두 앞선 assistant 의 호출과 짝이 맞는다
        const ids = new Set(c.flatMap((m) => m.tool_calls?.map((tc) => tc.id) ?? []));
        expect(c.filter((m) => m.role === 'tool').every((m) => ids.has(m.tool_call_id))).toBe(true);
    });

    it('예산 안이면 아무 것도 바꾸지 않는다', () => {
        const c = conv();
        const before = JSON.stringify(c);
        expect(compactWithHandoff(c, 1_000_000, byChars)).toEqual({ dropped: 0 });
        expect(JSON.stringify(c)).toBe(before);
    });

    it('최근 턴 하나가 예산보다 커도 그 턴(assistant+tool)은 통째로 남긴다', () => {
        const c = conv();
        compactWithHandoff(c, 10, byChars);
        const last = c[c.length - 1];
        expect(last.role).toBe('tool');
        expect(c[c.length - 2].tool_calls?.[0].id).toBe(last.tool_call_id);
    });

    it('두 번 줄여도 요약은 하나만 남는다', () => {
        const c = conv();
        compactWithHandoff(c, 900, byChars);
        c.push(...turn(5, 'bash', { command: 'git status' }, `[stdout]\n${'s'.repeat(900)}\n[exit=0 5ms]`));
        compactWithHandoff(c, 900, byChars);
        expect(c.filter((m) => isHandoffSummary(m.content)).length).toBe(1);
        expect(c[2].content).toContain('npm test -- billing');
    });
});
