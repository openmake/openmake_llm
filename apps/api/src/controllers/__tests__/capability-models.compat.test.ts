/**
 * T20 — 구형 클라이언트 호환: GET /api/users/me/capability-models 는 종전 필드(overrides·effective·assignableCapabilities)를
 * 그대로 주고 catalog 만 덧붙인다(P03). 구 웹·iOS 는 catalog 를 모르고도 동작해야 한다.
 */
jest.mock('../../auth/middleware', () => ({ requireAuth: (req: { user?: unknown }, _r: unknown, n: () => void) => { req.user = { id: 'u1' }; n(); } }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../data/repositories/capability-models-repo', () => ({ CapabilityModelsRepository: class { listByScope = async () => [{ scope: 'u1', capability: 'image.generate', fullId: 'hasa:flux', params: {}, updatedAt: new Date(0) }]; } }));
jest.mock('../../services/orchestrator/capability-resolver', () => ({
    ...jest.requireActual('../../services/orchestrator/capability-resolver'),
    resolveCapabilityTarget: async (capability: string) => ({ fullId: `local-llm:${capability}`, source: 'default' }),
}));
jest.mock('../../services/capability-catalog', () => ({ buildCapabilityCatalog: async () => ({ registryRevision: 3, entries: [{ id: 'image.generate', availability: 'disabled' }] }) }));

import express from 'express';
import request from 'supertest';
import { createCapabilityModelsController } from '../capability-models.controller';
import { ASSIGNABLE_CAPABILITIES } from '../../config/capabilities';

test('T20: 종전 필드는 그대로, catalog 는 추가 필드 — 꺼진 add-on 의 배정(overrides)도 지워지지 않는다(T19)', async () => {
    const app = express();
    app.use('/api/users/me/capability-models', createCapabilityModelsController());
    const r = await request(app).get('/api/users/me/capability-models');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data).sort()).toEqual(['assignableCapabilities', 'catalog', 'effective', 'overrides']);
    expect(r.body.data.assignableCapabilities).toEqual([...ASSIGNABLE_CAPABILITIES]);
    expect(r.body.data.overrides[0]).toMatchObject({ capability: 'image.generate', fullId: 'hasa:flux' });
    expect(r.body.data.effective).toHaveLength(ASSIGNABLE_CAPABILITIES.length);
    expect(r.body.data.catalog.entries[0]).toEqual({ id: 'image.generate', availability: 'disabled' });
});
