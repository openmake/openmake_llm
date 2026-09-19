import { createPlanTool } from '../plan-tool';

/**
 * 입력 가드 경로만 검증 (LLM 미호출). planner 후처리는 planner.test.ts 에서 검증.
 */
describe('create_plan 도구 입력 가드', () => {
    it('task 누락 → isError', async () => {
        const r = await createPlanTool.handler({}, undefined);
        expect(r.isError).toBe(true);
        expect((r.content[0] as { text: string }).text).toContain('task');
    });

    it('빈 task → isError', async () => {
        const r = await createPlanTool.handler({ task: '   ' }, undefined);
        expect(r.isError).toBe(true);
    });

    it('도구 메타: name/required 스키마', () => {
        expect(createPlanTool.tool.name).toBe('create_plan');
        expect(createPlanTool.tool.inputSchema.required).toContain('task');
    });
});
