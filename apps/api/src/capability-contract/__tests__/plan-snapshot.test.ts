/**
 * 스냅샷 기반 Planner 계약 (P03) — 목록·schema·검증이 같은 스냅샷을 보고, 웹 설정 키와 어긋나지 않는다(T07).
 */
import { CAPABILITY_LIMITS, PLANNABLE_CAPABILITIES, ASSIGNABLE_CAPABILITIES } from '../../config/capabilities';
import { getCapabilityRegistry, resetCapabilityRuntimeForTest, snapshotForExecution } from '../../runtime-ports/capability-runtime';
import { ensureLegacyCapabilityBridge, resetLegacyCapabilityBridgeForTest } from '../../addon-host/legacy-capability-bridge';
import { planJsonSchemaFor, plannerCapabilityLines } from '../plan-schema';
import { PLAN_JSON_SCHEMA, validatePlan } from '../../services/orchestrator/plan-schema';

beforeEach(() => { resetCapabilityRuntimeForTest(); resetLegacyCapabilityBridgeForTest(); ensureLegacyCapabilityBridge(); });

describe('ExecutionSnapshot', () => {
    it('plannable 집합·프롬프트 목록·schema 인자 키가 한 스냅샷에서 나온다', () => {
        const snap = snapshotForExecution();
        expect([...snap.plannable].sort()).toEqual([...PLANNABLE_CAPABILITIES].sort());
        const lines = plannerCapabilityLines(snap);
        for (const id of PLANNABLE_CAPABILITIES) expect(lines).toContain(`- ${id}: `);
        expect(lines).not.toContain('text.synthesize');
        const schema = planJsonSchemaFor(snap) as { properties: { tasks: { items: { properties: { input: { properties: Record<string, unknown> } } } } } };
        const keys = Object.keys(schema.properties.tasks.items.properties.input.properties);
        // T07: 종전 정적 schema 가 싣던 인자 키(영상·음악)가 빠지지 않는다 — 구조화 출력은 선언 안 된 키를 만들지 않는다
        for (const k of Object.keys(PLAN_JSON_SCHEMA.properties.tasks.items.properties.input.properties)) expect(keys).toContain(k);
        expect(keys).toEqual(expect.arrayContaining(['seconds', 'size', 'negative_prompt', 'duration', 'lyrics', 'voice', 'format']));
        expect(snap.schemaHash).toHaveLength(16);
    });

    it('T07: 배정 params(settingsSchema) 키가 서버 화이트리스트 PARAM_KEYS 와 같다 — 웹은 이 schema 를 그린다', () => {
        const snap = snapshotForExecution();
        for (const id of ASSIGNABLE_CAPABILITIES) {
            const def = snap.capabilities.find(e => e.definition.id === id)!.definition;
            const keys = Object.keys((def.settingsSchema as { properties: Record<string, unknown> }).properties);
            expect(keys.sort()).toEqual([...CAPABILITY_LIMITS.PARAM_KEYS[id]].sort());
        }
    });

    it('소유 add-on 이 빠지면(Registry 회수) 같은 요청의 목록·schema·검증에서 모두 사라진다', () => {
        // image-runtime 이 꺼진 배포를 흉내: Base bridge 의 image 두 ID 를 회수한다
        const registry = getCapabilityRegistry();
        const before = registry.revision;
        registry.unregisterOwner('base');
        const tx = registry.beginRegistration({ addonId: 'base', addonVersion: '1', source: 'builtin' });
        for (const e of snapshotForExecution().capabilities) tx.register(e.definition, { execute: async () => ({ ok: true, text: '', media: [] }) });
        tx.commit();
        resetLegacyCapabilityBridgeForTest(); ensureLegacyCapabilityBridge();
        const full = snapshotForExecution();
        expect(full.plannable.has('image.generate')).toBe(true);

        const withoutImage = { ...full, plannable: new Set([...full.plannable].filter(c => !c.startsWith('image.'))), capabilities: full.capabilities.filter(e => !e.definition.id.startsWith('image.')) };
        expect(plannerCapabilityLines(withoutImage)).not.toContain('image.generate');
        const r = validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'image.generate', input: { instruction: 'x' } }] }, new Set(), withoutImage.plannable);
        expect(r.ok).toBe(false);
        expect((r as { reason: string }).reason).toMatch(/not plannable/);
        expect(full.registryRevision).toBeGreaterThan(before);
    });
});
