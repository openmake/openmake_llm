import { codeReviewTool } from '../code-review-tool';
import { CODE_REVIEW_CONFIG } from '../../config/code-review';

describe('code_review 도구 입력 가드', () => {
    it('code 누락 → isError', async () => {
        const r = await codeReviewTool.handler({}, undefined);
        expect(r.isError).toBe(true);
        expect((r.content[0] as { text: string }).text).toContain('code');
    });
    it('빈 code → isError', async () => {
        const r = await codeReviewTool.handler({ code: '  ' }, undefined);
        expect(r.isError).toBe(true);
    });
    it('크기 초과 → isError (LLM 호출 전)', async () => {
        const big = 'a'.repeat(CODE_REVIEW_CONFIG.maxCodeBytes + 1);
        const r = await codeReviewTool.handler({ code: big }, undefined);
        expect(r.isError).toBe(true);
        expect((r.content[0] as { text: string }).text).toContain('너무 큽니다');
    });
    it('도구 메타', () => {
        expect(codeReviewTool.tool.name).toBe('code_review');
        expect(codeReviewTool.tool.inputSchema.required).toContain('code');
    });
});
