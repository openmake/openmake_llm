import { securityReviewTool } from '../security-review-tool';
import { SECURITY_REVIEW_CONFIG } from '../../config/security-review';

/**
 * 입력 가드 경로만 검증 (LLM 미호출). analyzer 후처리 로직은 analyzer.test.ts 에서 검증.
 */
describe('security_review 도구 입력 가드', () => {
    it('code 누락 → isError', async () => {
        const r = await securityReviewTool.handler({}, undefined);
        expect(r.isError).toBe(true);
        expect((r.content[0] as { text: string }).text).toContain('code');
    });

    it('빈 code → isError', async () => {
        const r = await securityReviewTool.handler({ code: '   ' }, undefined);
        expect(r.isError).toBe(true);
    });

    it('크기 초과 → isError (LLM 호출 전 거부)', async () => {
        const big = 'a'.repeat(SECURITY_REVIEW_CONFIG.maxCodeBytes + 1);
        const r = await securityReviewTool.handler({ code: big }, undefined);
        expect(r.isError).toBe(true);
        expect((r.content[0] as { text: string }).text).toContain('너무 큽니다');
    });

    it('도구 메타: name/required 스키마', () => {
        expect(securityReviewTool.tool.name).toBe('security_review');
        expect(securityReviewTool.tool.inputSchema.required).toContain('code');
    });
});
