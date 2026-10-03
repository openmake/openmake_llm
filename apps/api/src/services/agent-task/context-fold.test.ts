import { foldOldToolResults, foldedDigestOf, foldedHeadOf, isFoldedToolResult, FOLD_MARKER } from './context-fold';
import { getToolResultSpillNotice } from '../../prompts/agent-task-context';
import { CONTEXT_FOLD_BATCH } from '../../config/agent-task-context';
import type { ChatMessage } from '../../llm/types';

// 묶음 임계는 0 으로 고정한다(기본값은 8000 — 여기 대화는 그보다 작다). 묶음 동작은 아래 '묶음 임계' 테스트가 따로 본다.
const OPTS = { keepTurns: 2, minChars: 100, headChars: 40, minBatchSavedChars: 0 };
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
        // 재읽기 유도 금지 — "다시 호출하세요" 문구가 같은 파일 25턴 반복 읽기를 유도했다(2026-09-09 실측)
        expect(tools[0].content).not.toContain('다시 호출');
        expect(tools[0].content).toContain('다시 읽지 마세요');
    });

    it('파일로 보관한 결과(미리보기 + 경로 안내)를 접어도 보관 경로는 스텁에 남는다', () => {
        const c = conv(4);
        const path = '.tool-results/bash-1a2b3c4d.txt';
        const tool = c.filter((m) => m.role === 'tool')[0];
        tool.content = `[stdout]\n${'row\n'.repeat(300)}[exit=0 5ms]\n${getToolResultSpillNotice(path, 132015, 6002, 180)}`;
        foldOldToolResults(c, OPTS);
        expect(isFoldedToolResult(tool.content)).toBe(true);
        expect(tool.content.split('\n')[0]).toContain(path);
        // 다시 실행하라고 하지 않는다(재읽기 루프 방지 문구는 그대로)
        expect(tool.content).not.toContain('다시 호출');
        // 스텁의 다른 읽기(한 줄 요약·앞부분)는 그대로 동작한다
        expect(foldedHeadOf(tool.content).startsWith('[stdout]')).toBe(true);
        expect(foldedDigestOf(tool.content) ?? '').not.toContain(path);
        // 보관하지 않은 결과의 스텁에는 경로 문구가 없다
        expect(c.filter((m) => m.role === 'tool')[1].content).not.toContain('.tool-results');
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

    it('묶음 임계 — 회수량이 임계보다 적으면 과거 메시지를 고치지 않고, 쌓여서 넘으면 한꺼번에 접는다', () => {
        const c = conv(3); // 접을 수 있는 결과 1건(약 500자)
        const before = JSON.stringify(c);
        expect(foldOldToolResults(c, { ...OPTS, minBatchSavedChars: 600 })).toEqual({ folded: 0, savedChars: 0 });
        expect(JSON.stringify(c)).toBe(before);
        c.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c9', type: 'function', function: { name: 'bash', arguments: {} } }] });
        c.push({ role: 'tool', content: big('turn9'), tool_name: 'bash', tool_call_id: 'c9' });
        const st = foldOldToolResults(c, { ...OPTS, minBatchSavedChars: 600 });
        expect(st.folded).toBe(2);
        expect(st.savedChars).toBeGreaterThanOrEqual(600);
    });

    it('묶음 임계 — 미뤄 둔 분량은 언제나 임계 미만이다(대화가 임계보다 더 부풀지 않는다)', () => {
        const threshold = 1500;
        const c = conv(0);
        for (let t = 0; t < 20; t++) {
            c.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${t}`, type: 'function', function: { name: 'bash', arguments: {} } }] });
            c.push({ role: 'tool', content: `turn${t} ` + 'y'.repeat(300 + (t % 4) * 200), tool_name: 'bash', tool_call_id: `c${t}` });
            foldOldToolResults(c, { ...OPTS, minBatchSavedChars: threshold });
            // 지금 임계 없이 접으면 회수될 분량 = 미뤄 둔 분량
            const deferred = foldOldToolResults(c.map((m) => ({ ...m })), { ...OPTS, minBatchSavedChars: 0 }).savedChars;
            expect(deferred).toBeLessThan(threshold);
        }
        expect(c.filter((m) => m.role === 'tool' && isFoldedToolResult(m.content)).length).toBeGreaterThan(0);
    });

    it('묶음 임계를 주지 않으면 설정 기본값(8000자)을 쓴다 — 작은 회수는 미루고, 넘으면 접는다', () => {
        const { minBatchSavedChars: _unused, ...noBatch } = OPTS;
        expect(CONTEXT_FOLD_BATCH.MIN_SAVED_CHARS).toBe(8000);
        const small = conv(3);
        expect(foldOldToolResults(small, noBatch).folded).toBe(0);
        const large = conv(5, 3000); // 오래된 3건 × 약 2,900자 회수 = 8,000자 초과
        expect(foldOldToolResults(large, noBatch).folded).toBe(3);
    });
});
