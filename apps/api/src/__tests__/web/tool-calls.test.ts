/** 채팅의 도구 호출 목록(apps/web/lib/tool-calls.ts) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
interface Call { toolName: string; status: 'running' | 'done' | 'error'; durationMs?: number; args?: string; preview?: string }
type Summary = { ok: boolean; durationMs: number; args?: string; preview?: string };
const { startToolCall, finishToolCall, settleToolCalls } = require('../../../../web/lib/tool-calls') as {
    startToolCall: (calls: Call[], toolName: string) => Call[];
    finishToolCall: (calls: Call[], toolName: string, summary?: Summary) => Call[];
    settleToolCalls: (calls: Call[]) => Call[];
};

describe('startToolCall', () => {
    it('실행 중 항목을 뒤에 붙인다(원본은 바꾸지 않는다)', () => {
        const a: Call[] = [];
        const b = startToolCall(a, 'web_search');
        expect(b).toEqual([{ toolName: 'web_search', status: 'running' }]);
        expect(a).toEqual([]);
    });
});

describe('finishToolCall', () => {
    it('같은 이름의 실행 중 항목을 결과로 바꾼다', () => {
        const calls = startToolCall([], 'web_search');
        expect(finishToolCall(calls, 'web_search', { ok: true, durationMs: 120, args: '{"query":"q"}', preview: '결과' }))
            .toEqual([{ toolName: 'web_search', status: 'done', durationMs: 120, args: '{"query":"q"}', preview: '결과' }]);
    });
    it('실패한 호출은 error', () => {
        const calls = startToolCall([], 'bash');
        expect(finishToolCall(calls, 'bash', { ok: false, durationMs: 5, preview: 'Error: x' })[0].status).toBe('error');
    });
    it('같은 도구를 여러 번 부르면 가장 먼저 시작한 실행 중 항목부터 닫는다', () => {
        let calls = startToolCall([], 'web_search');
        calls = startToolCall(calls, 'web_search');
        calls = finishToolCall(calls, 'web_search', { ok: true, durationMs: 1, preview: '첫째' });
        expect(calls.map((c) => c.status)).toEqual(['done', 'running']);
        expect(calls[0].preview).toBe('첫째');
    });
    it('시작 이벤트를 못 받은 결과는 끝난 항목으로 새로 붙인다', () => {
        expect(finishToolCall([], 'web_search', { ok: true, durationMs: 3 })).toEqual([{ toolName: 'web_search', status: 'done', durationMs: 3 }]);
    });
    it('요약이 없는 결과(구버전 서버)는 실행 중 항목을 끝난 것으로만 바꾼다', () => {
        expect(finishToolCall(startToolCall([], 'x'), 'x')).toEqual([{ toolName: 'x', status: 'done' }]);
    });
});

describe('settleToolCalls — 답변이 끝났는데 남은 실행 중 항목', () => {
    it('끝난 것으로 닫는다(중단·오류로 결과 이벤트가 오지 않은 호출이 계속 도는 것처럼 보이지 않게)', () => {
        const calls = finishToolCall(startToolCall(startToolCall([], 'a'), 'b'), 'a', { ok: true, durationMs: 1 });
        expect(settleToolCalls(calls).map((c) => c.status)).toEqual(['done', 'error']);
    });
});
