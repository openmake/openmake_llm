/**
 * runTool — 외부 도구(검색·MCP) 결과가 상한을 넘을 때 끝부분이 남고 생략 표시가 붙는지.
 */
jest.mock('../../tool-result-truncation-recorder', () => ({ recordToolResultTruncation: jest.fn() }));

import { runTool } from '../task-steps';
import { MAX_TOOL_RESULT_CHARS } from '../../../config/runtime-limits';
import type { ToolRuntime } from '../../../runtime-ports/tool-runtime';

const ctx = { userId: 'u1', role: 'user' } as never;
const runtimeReturning = (content: unknown, isError = false): ToolRuntime =>
    ({ executeTool: jest.fn(async () => ({ content, isError })) }) as unknown as ToolRuntime;

describe('runTool 결과 절단', () => {
    it('긴 결과의 앞·뒤를 남기고 가운데 생략을 알린다', async () => {
        const raw = `HEAD-MARK ${'x'.repeat(MAX_TOOL_RESULT_CHARS * 2)} TAIL-MARK`;
        const out = await runTool(runtimeReturning(raw), 'web_search', {}, ctx);
        expect(out.startsWith('HEAD-MARK')).toBe(true);
        expect(out.endsWith('TAIL-MARK')).toBe(true);
        expect(out).toMatch(/가운데 \d+자 생략 — 전체 \d+자/);
    });

    it('짧은 결과는 그대로 돌려준다', async () => {
        expect(await runTool(runtimeReturning('결과'), 'web_search', {}, ctx)).toBe('결과');
    });

    it('오류 결과는 Error: 머리말을 유지한다', async () => {
        expect(await runTool(runtimeReturning('실패', true), 'web_search', {}, ctx)).toBe('Error: 실패');
    });
});
