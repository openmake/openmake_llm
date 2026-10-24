/**
 * runTool 결과 문자열(2026-10-24) — content 배열을 JSON 이 아닌 텍스트로 넘긴다.
 * 종전엔 `Error: [{"type":"text","text":"오류: …"}]` 처럼 배열이 통째로 직렬화돼 작업 스텝·모델 입력에 보였다.
 */
import { runTool } from '../task-steps';

describe('runTool — 결과 텍스트', () => {
    it('isError 결과의 text 항목은 JSON 없이 Error: 접두로 돌려준다', async () => {
        const executeTool = jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: '오류: X\n[오류 유형: provider, 재시도 가능]' }],
            isError: true,
        });
        const out = await runTool({ executeTool } as never, 'x', {}, { userId: 'u' } as never);
        expect(out).toBe('Error: 오류: X\n[오류 유형: provider, 재시도 가능]');
        expect(out).not.toContain('[{');
    });

    it('정상 결과의 text 항목도 JSON 이 아닌 원문이다', async () => {
        const executeTool = jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: '첫째 "줄"' }, { type: 'text', text: '둘째 줄' }],
        });
        const out = await runTool({ executeTool } as never, 'x', {}, { userId: 'u' } as never);
        expect(out).toBe('첫째 "줄"\n둘째 줄');
    });

    it('문자열 content 는 그대로 돌려준다', async () => {
        const executeTool = jest.fn().mockResolvedValue({ content: 'plain "text"' });
        const out = await runTool({ executeTool } as never, 'x', {}, { userId: 'u' } as never);
        expect(out).toBe('plain "text"');
    });
});
