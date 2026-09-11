/**
 * GET /api/admin/capability-models 응답 계약 — 프론트(admin/model-roles GlobalCapabilityModelsCard)가
 * `assignableCapabilities` 로 행을 그린다. 2026-09-12 라이브에서 옛 키(`modalities`)가 남아 카드가 빈 채 렌더된 회귀 고정.
 */
jest.mock('../../auth', () => ({ requireAuth: (_r: unknown, _s: unknown, n: () => void) => n(), requireAdmin: (_r: unknown, _s: unknown, n: () => void) => n() }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../data/repositories/capability-models-repo', () => ({ CapabilityModelsRepository: class { listGlobal = async () => []; } }));
jest.mock('../../controllers/capability-models.controller', () => ({ describeEffectiveCapabilities: async () => [] }));
jest.mock('../../config', () => ({ getConfig: () => ({ llmGatewayProviders: ['hasa'] }) }));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: async () => undefined }) }));

import { adminCapabilityModelsRouter } from '../admin-capability-models.routes';
import { ASSIGNABLE_CAPABILITIES } from '../../config/capabilities';

interface Layer { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: unknown, res: unknown, next: (e?: unknown) => void) => unknown }> } }

test('목록 응답에 assignableCapabilities·gatewayProviders 가 실린다', async () => {
    const layer = (adminCapabilityModelsRouter as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === '/capability-models' && l.route.methods.get);
    if (!layer?.route) throw new Error('route not found');
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    // asyncHandler 는 void 를 돌려주므로 res.json 호출을 기다린다
    const body = await new Promise<{ data?: Record<string, unknown> }>((resolve, reject) => {
        const res = { json: (b: { data?: Record<string, unknown> }) => resolve(b), status: () => res };
        void handler({ params: {}, query: {} }, res, (e) => reject(e ?? new Error('next()')));
    });
    expect(body.data?.assignableCapabilities).toEqual(ASSIGNABLE_CAPABILITIES);
    expect(body.data?.gatewayProviders).toEqual(['hasa']);
    expect(body.data).not.toHaveProperty('modalities');
});
