/**
 * ToolRouter × 서킷 통합 — 노출 필터와 실행 거절이 실제로 걸리는지.
 *
 * 계약 셋:
 *  ① 반복 실패한 외부 도구는 `getAllTools` 결과에서 빠진다(채팅·작업·딥리서치 공통 소스).
 *  ② 노출에서 빠져도 이름으로 호출되면 즉시 거절된다(모델이 이름을 기억하는 경우의 2차 방어).
 *  ③ 그 거절은 실패로 세지 않는다 — 세면 차단이 스스로를 무한 연장한다.
 */
import { TOOL_CIRCUIT } from '../../config/tool-health';
import { ToolRouter } from '../tool-router';
import { getCircuitSnapshot, __resetCircuitsForTest } from '../tool-health';

const mutable = TOOL_CIRCUIT as unknown as Record<string, unknown>;
const original = { ...TOOL_CIRCUIT };

function makeRouter(fail: boolean): ToolRouter {
    const router = new ToolRouter();
    router.registerExternalTools(
        'srv-1',
        'srv',
        [{ name: 'flaky', description: 'test', inputSchema: { type: 'object', properties: {} } }],
        async () => {
            if (fail) throw new Error('upstream 502 bad gateway');
            return { content: [{ type: 'text', text: 'ok' }] };
        },
    );
    return router;
}

describe('ToolRouter 서킷 통합', () => {
    beforeEach(() => {
        __resetCircuitsForTest();
        Object.assign(mutable, original, { ENABLED: true, FAILURE_THRESHOLD: 3, MIN_CALLS: 3, OPEN_MS: 60000 });
    });
    afterEach(() => Object.assign(mutable, original));

    it('반복 실패한 도구는 노출 목록에서 빠진다', async () => {
        const router = makeRouter(true);
        const before = await router.getAllTools();
        expect(before.some((t) => t.name === 'srv::flaky')).toBe(true);

        for (let i = 0; i < 3; i++) await router.executeTool('srv::flaky', {});

        const after = await router.getAllTools();
        expect(after.some((t) => t.name === 'srv::flaky')).toBe(false);
        // 다른 도구는 그대로 — 차단은 해당 도구에만 국소적이어야 한다.
        expect(after.length).toBe(before.length - 1);
    });

    it('차단 후 호출은 즉시 거절되고, 그 거절은 실패로 세지 않는다', async () => {
        const router = makeRouter(true);
        for (let i = 0; i < 3; i++) await router.executeTool('srv::flaky', {});
        const failuresWhenOpened = getCircuitSnapshot()[0].failuresInWindow;

        const rejected = await router.executeTool('srv::flaky', {});
        expect(rejected.isError).toBe(true);
        expect((rejected.content[0] as { text: string }).text).toContain('일시 비활성화');

        // 거절이 카운트되면 failuresInWindow 가 늘어난다 → 차단이 스스로를 연장한다.
        expect(getCircuitSnapshot()[0].failuresInWindow).toBe(failuresWhenOpened);
    });

    it('게이트 OFF 면 반복 실패해도 노출·실행이 그대로다', async () => {
        Object.assign(mutable, { ENABLED: false });
        const router = makeRouter(true);
        for (let i = 0; i < 10; i++) await router.executeTool('srv::flaky', {});
        const tools = await router.getAllTools();
        expect(tools.some((t) => t.name === 'srv::flaky')).toBe(true);
        const result = await router.executeTool('srv::flaky', {});
        expect((result.content[0] as { text: string }).text).not.toContain('일시 비활성화');
    });

    it('성공하는 도구는 아무리 호출해도 차단되지 않는다', async () => {
        const router = makeRouter(false);
        for (let i = 0; i < 10; i++) await router.executeTool('srv::flaky', {});
        const tools = await router.getAllTools();
        expect(tools.some((t) => t.name === 'srv::flaky')).toBe(true);
        expect(getCircuitSnapshot()).toHaveLength(0);
    });
});
