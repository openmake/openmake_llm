/**
 * P05 코드 수준 수용 — T01 미디어 add-on 전부 OFF 여도 텍스트·검색 작업은 승인·실행된다 · T19 꺼진 add-on 의 배정은 지우지 않고
 * disabled 로 보인다 · T20 구형 클라이언트가 읽는 응답 필드(overrides·effective·assignableCapabilities)는 그대로다.
 */
jest.mock('../../config', () => ({ getConfig: () => ({ llmBaseUrl: 'http://gw', llmApiKey: 'k', llmGatewayProviders: [] }) }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}), getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../../llm/user-quota', () => ({ reserveUserQuota: async () => null, settleUserQuota: async () => undefined, recordUserUsage: async () => undefined, checkUserQuota: async () => undefined }));
jest.mock('../addon/addon-state', () => ({ readAddonStateStrict: async () => ({ known: false, reason: 'db down' }), clearAddonStateCache: () => undefined }));

import { getCapabilityRegistry, resetCapabilityRuntimeForTest } from '../../runtime-ports/capability-runtime';
import { ensureLegacyCapabilityBridge, resetLegacyCapabilityBridgeForTest } from '../../addon-host/legacy-capability-bridge';
import { buildCapabilityCatalog } from '../capability-catalog';
import { validatePlan } from '../orchestrator/plan-schema';
import { preflightPlan } from '../orchestrator/preflight';
import type { ExecContext } from '../orchestrator/types';

beforeEach(() => { resetCapabilityRuntimeForTest(); resetLegacyCapabilityBridgeForTest(); ensureLegacyCapabilityBridge(); });

describe('P05 수용(코드 수준)', () => {
    it('T01: 미디어 runtime add-on 이 하나도 없고 상태 저장소도 죽어도 Base capability(웹 검색)는 승인된다', async () => {
        expect(getCapabilityRegistry().has('image.generate')).toBe(false);
        expect(getCapabilityRegistry().has('video.generate')).toBe(false);
        const v = validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'web.search', input: { instruction: '뉴스' } }] }, new Set());
        if (!v.ok) throw new Error(v.reason);
        const ctx = { userId: 'u1', lang: 'ko', userMessage: 'q', attachments: new Map(), results: new Map() } as unknown as ExecContext;
        const pre = await preflightPlan(v.plan, ctx);
        expect(pre.rejected.size).toBe(0);
        expect(pre.handles.get('t1')?.owner.addonId).toBe('base');
        // 미디어 작업은 계획 검증부터 거절 — Planner 에 노출되지 않는 것과 같은 스냅샷
        expect(validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'image.generate', input: { instruction: 'x' } }] }, new Set()).ok).toBe(false);
    });

    it('T19: 소유 add-on 이 꺼진 capability 도 카탈로그에 남아 disabled 로 표시된다(배정 설정 보존)', async () => {
        const catalog = await buildCapabilityCatalog();
        const image = catalog.entries.find((e) => e.id === 'image.generate');
        expect(image).toMatchObject({ availability: 'disabled', owner: 'none', assignable: true, plannable: false });
        expect(catalog.entries.find((e) => e.id === 'text.reason')).toMatchObject({ availability: 'available', owner: 'base' });
    });
});
