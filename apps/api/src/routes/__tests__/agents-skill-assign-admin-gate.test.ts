/**
 * POST/DELETE /api/agents/:agentId/skills/:skillId 관리자 게이트 회귀 테스트 (2026-09-02 보안 리뷰 H2)
 * 라우터 스택을 직접 검사해 requireAdmin 이 두 라우트에 배선돼 있는지 확인한다.
 */
import agentsRouter from '../agents.routes';
import { requireAdmin } from '../../auth';

interface Layer { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }

function handlersFor(method: 'post' | 'delete', path: string): unknown[] {
    const layers = (agentsRouter as unknown as { stack: Layer[] }).stack;
    const layer = layers.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    if (!layer?.route) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
    return layer.route.stack.map((s) => s.handle);
}

describe('공유 에이전트 스킬 배정은 관리자만', () => {
    test('POST /:agentId/skills/:skillId 에 requireAdmin 배선', () => {
        expect(handlersFor('post', '/:agentId/skills/:skillId')).toContain(requireAdmin);
    });
    test('DELETE /:agentId/skills/:skillId 에 requireAdmin 배선', () => {
        expect(handlersFor('delete', '/:agentId/skills/:skillId')).toContain(requireAdmin);
    });
});
