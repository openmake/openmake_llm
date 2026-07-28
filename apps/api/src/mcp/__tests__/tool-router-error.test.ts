import { ToolRouter } from '../tool-router';

/**
 * executeTool 의 에러 분류·교정 힌트 통합 검증 (Harness Engineering: 에러 분류 + remediation).
 */
describe('ToolRouter.executeTool 에러 분류 통합', () => {
    it('알 수 없는 내장 도구 → not_found 분류 + isError', async () => {
        const router = new ToolRouter();
        const result = await router.executeTool('definitely_unknown_tool', {});
        expect(result.isError).toBe(true);
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('[오류 유형: not_found]');
    });

    it('등록되지 않은 외부 도구(::) → not_found 분류 + isError', async () => {
        const router = new ToolRouter();
        const result = await router.executeTool('ghost::call', {});
        expect(result.isError).toBe(true);
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('외부 도구를 찾을 수 없습니다');
        expect(text).toContain('[오류 유형: not_found]');
    });
});
