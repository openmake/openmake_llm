import { foldOldToolResults, isFoldedToolResult, FOLD_MARKER } from './context-fold';
import type { ChatMessage } from '../../llm/types';

const OPTS = { keepTurns: 2, minChars: 100, headChars: 40 };
const big = (tag: string) => `${tag} ` + 'x'.repeat(500);

function conv(turns: number, resultChars = 500): ChatMessage[] {
    const c: ChatMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'goal' }];
    for (let t = 0; t < turns; t++) {
        c.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${t}`, type: 'function', function: { name: 'bash', arguments: {} } }] });
        c.push({ role: 'tool', content: `turn${t} ` + 'y'.repeat(resultChars), tool_name: 'bash', tool_call_id: `c${t}` });
    }
    return c;
}

describe('foldOldToolResults', () => {
    it('keepTurns 이내 턴은 원문 유지, 그보다 오래된 큰 결과만 접는다', () => {
        const c = conv(4);
        const st = foldOldToolResults(c, OPTS);
        expect(st.folded).toBe(2);
        expect(st.savedChars).toBeGreaterThan(0);
        const tools = c.filter((m) => m.role === 'tool');
        expect(isFoldedToolResult(tools[0].content)).toBe(true);
        expect(isFoldedToolResult(tools[1].content)).toBe(true);
        expect(isFoldedToolResult(tools[2].content)).toBe(false);
        expect(isFoldedToolResult(tools[3].content)).toBe(false);
        // 스텁은 도구명·원문 길이·앞부분을 담는다(judge 증거창용)
        expect(tools[0].content).toContain('bash');
        expect(tools[0].content).toContain('turn0');
        expect(tools[0].content.startsWith(FOLD_MARKER)).toBe(true);
    });

    it('아직 keepTurns 를 넘는 턴이 없으면 아무 것도 접지 않는다', () => {
        const c = conv(2);
        expect(foldOldToolResults(c, OPTS)).toEqual({ folded: 0, savedChars: 0 });
        expect(c.filter((m) => m.role === 'tool').every((m) => !isFoldedToolResult(m.content))).toBe(true);
    });

    it('minChars 이하의 결과는 오래돼도 접지 않는다', () => {
        const c = conv(4, 50);
        expect(foldOldToolResults(c, OPTS).folded).toBe(0);
    });

    it('멱등 — 두 번 호출해도 이미 접힌 스텁은 다시 접지 않는다', () => {
        const c = conv(5);
        foldOldToolResults(c, OPTS);
        const again = foldOldToolResults(c, OPTS);
        expect(again.folded).toBe(0);
    });

    it('턴이 늘면 접기 경계가 앞으로 이동한다', () => {
        const c = conv(3);
        expect(foldOldToolResults(c, OPTS).folded).toBe(1);
        c.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c9', type: 'function', function: { name: 'bash', arguments: {} } }] });
        c.push({ role: 'tool', content: big('turn9'), tool_name: 'bash', tool_call_id: 'c9' });
        expect(foldOldToolResults(c, OPTS).folded).toBe(1);
    });

    it('system·user·assistant 메시지는 건드리지 않는다', () => {
        const c = conv(4);
        c[1].content = 'goal ' + 'g'.repeat(1000);
        foldOldToolResults(c, OPTS);
        expect(c[0].content).toBe('sys');
        expect(c[1].content.startsWith('goal ')).toBe(true);
        expect(c[1].content.length).toBe(1005);
    });
});
