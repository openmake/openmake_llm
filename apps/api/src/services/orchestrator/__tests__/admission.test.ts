/**
 * 실행 승인(admission, P03) — 계획 뒤 disable(T03)·상태 저장소 조회 실패(T22)·Planner 없는 직접 경로(T23)에서
 * 유료 요청이 0회여야 한다. 실행기(handler)를 spy 로 두고 호출 수를 센다.
 */
jest.mock('../../../config', () => ({ getConfig: () => ({ llmBaseUrl: 'http://gw', llmApiKey: 'k', llmGatewayProviders: [] }) }));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}), getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../../../config/capabilities', () => ({ ...jest.requireActual('../../../config/capabilities'), CAPABILITY_DEFAULTS: { ...jest.requireActual('../../../config/capabilities').CAPABILITY_DEFAULTS, 'image.generate': 'local-llm:img-gen' } }));
jest.mock('../../../data/repositories/capability-models-repo', () => ({ CapabilityModelsRepository: class { get = async () => null; listGlobal = async () => []; } }));
jest.mock('../../../llm/user-quota', () => ({ checkUserQuota: async () => undefined, recordUserUsage: async () => undefined, reserveUserQuota: async () => null, settleUserQuota: async () => undefined }));
jest.mock('../../../data/repositories/orchestrator-runs-repo', () => ({ OrchestratorRunsRepository: class { insert = async () => undefined; } }));
jest.mock('../../../data/repositories/orchestrator-jobs-repo', () => ({ OrchestratorJobsRepository: class { listRecent = async () => []; } }));
jest.mock('../../../services/cost/cost-ledger-service', () => ({ recordLlmCost: () => undefined, recordCost: () => undefined }));

const stateMock = { current: { known: true, registered: true, state: 'enabled', desiredState: 'enabled', stateRevision: 1, lastFailureCode: null } as unknown };
jest.mock('../../../services/addon/addon-state', () => ({
    readAddonStateStrict: async () => stateMock.current,
    ensureAddonStates: async () => undefined, isAddonEnabledSync: () => true, clearAddonStateCache: () => undefined,
}));

import { getCapabilityRegistry, resetCapabilityRuntimeForTest } from '../../../runtime-ports/capability-runtime';
import { ensureLegacyCapabilityBridge, resetLegacyCapabilityBridgeForTest } from '../../../addon-host/legacy-capability-bridge';
import { validatePlan } from '../plan-schema';
import { preflightPlan } from '../preflight';
import { executePlan } from '../executor';
import { runSingleCapabilityTask } from '../orchestrate';
import type { ExecContext } from '../types';
import type { CapabilityDefinition } from '../../../capability-contract/types';

const CAP = 'image.generate';
const OWNER = { addonId: 'image-runtime', addonVersion: '1.0.0', source: 'builtin' as const };
const provider = jest.fn(async () => ({ ok: true, text: 'made', media: [] }));

function registerAsAddon(): void {
    const registry = getCapabilityRegistry();
    const keep = registry.list().filter(r => r.definition.id !== CAP && r.definition.id !== 'image.edit');
    registry.resetForTest();
    const base = registry.beginRegistration({ addonId: 'base', addonVersion: '1', source: 'builtin' });
    for (const r of keep) base.register(r.definition, r.handler);
    base.commit();
    const def: CapabilityDefinition = {
        id: CAP, contractVersion: 1, assignable: true, plannable: true, display: { label: '이미지 생성', group: 'image', order: 20 }, plannerHint: 'h',
        inputSchema: { type: 'object', properties: {} }, settingsSchema: { type: 'object', properties: {} },
        execution: { mode: 'sync', timeoutMs: 1000, supportsCancellation: true }, output: { mimeTypes: ['image/png'] },
    };
    const tx = registry.beginRegistration(OWNER);
    tx.register(def, { execute: provider });
    tx.commit([CAP]);
}

const ctx = (): ExecContext => ({ userId: 'u1', lang: 'ko', userMessage: 'draw', attachments: new Map(), results: new Map() });

beforeEach(() => {
    provider.mockClear();
    resetCapabilityRuntimeForTest(); resetLegacyCapabilityBridgeForTest(); ensureLegacyCapabilityBridge();
    registerAsAddon();
    stateMock.current = { known: true, registered: true, state: 'enabled', desiredState: 'enabled', stateRevision: 1, lastFailureCode: null };
});

describe('admission', () => {
    it('승인 → 실행: handle 이 발급되고 handler 가 1회 불린다', async () => {
        const v = validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: CAP, input: { instruction: 'cat' } }] }, new Set());
        if (!v.ok) throw new Error(v.reason);
        const c = ctx();
        const pre = await preflightPlan(v.plan, c);
        expect(pre.rejected.size).toBe(0);
        expect(pre.handles.get('t1')).toMatchObject({ capability: CAP, owner: OWNER, userId: 'u1', stateRevision: 1 });
        c.targets = pre.targets; c.handles = pre.handles;
        const s = await executePlan(v.plan, c);
        expect(s.ok).toBe(1);
        expect(provider).toHaveBeenCalledTimes(1);
    });

    it('T03: 계획·승인 뒤 관리자가 add-on 을 끄면 실행 직전 차단 — provider 호출 0회', async () => {
        const v = validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: CAP, input: { instruction: 'cat' } }] }, new Set());
        if (!v.ok) throw new Error(v.reason);
        const c = ctx();
        const pre = await preflightPlan(v.plan, c);
        expect(pre.handles.has('t1')).toBe(true);
        c.targets = pre.targets; c.handles = pre.handles;
        stateMock.current = { known: true, registered: true, state: 'disabled', desiredState: 'disabled', stateRevision: 2, lastFailureCode: null };
        const s = await executePlan(v.plan, c);
        expect(s.failed).toBe(1);
        expect(s.results[0].text).toMatch(/^\[disabled\]/);
        expect(provider).not.toHaveBeenCalled();
    });

    it('T22: 상태 저장소를 읽지 못하면 preflight 가 state_unknown 으로 거절한다(정책 없음으로 읽지 않는다)', async () => {
        stateMock.current = { known: false, reason: 'ECONNREFUSED' };
        const v = validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: CAP, input: { instruction: 'cat' } }] }, new Set());
        if (!v.ok) throw new Error(v.reason);
        const pre = await preflightPlan(v.plan, ctx());
        expect(pre.rejected.get('t1')).toMatch(/^\[state_unknown\]/);
        expect(pre.handles.has('t1')).toBe(false);
    });

    it('Base 소유 capability(text.reason)는 상태 저장소 장애와 무관하게 승인된다', async () => {
        stateMock.current = { known: false, reason: 'down' };
        const v = validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'web.search', input: { instruction: 'x' } }] }, new Set());
        if (!v.ok) throw new Error(v.reason);
        const pre = await preflightPlan(v.plan, ctx());
        expect(pre.rejected.size).toBe(0);
        expect(pre.handles.get('t1')?.owner.addonId).toBe('base');
    });

    it('T23/T02: Registry 에서 빠지면(소유 add-on OFF) Planner 없는 직접 경로도 [disabled] 로 거절 — provider 0회', async () => {
        getCapabilityRegistry().unregisterOwner('image-runtime');
        await expect(runSingleCapabilityTask({ capability: CAP, instruction: 'cat', userId: 'u1', lang: 'ko' })).rejects.toThrow(/^\[disabled\]/);
        expect(provider).not.toHaveBeenCalled();
    });

    it('handle 없는 작업은 실행하지 않는다(승인 경계 우회 방지)', async () => {
        const v = validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: CAP, input: { instruction: 'cat' } }] }, new Set());
        if (!v.ok) throw new Error(v.reason);
        const c = ctx(); c.handles = new Map();
        const s = await executePlan(v.plan, c);
        expect(s.results[0].text).toMatch(/\[unapproved\]/);
        expect(provider).not.toHaveBeenCalled();
    });
});
