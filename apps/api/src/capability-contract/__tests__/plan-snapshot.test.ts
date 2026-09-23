/**
 * 스냅샷 기반 Planner 계약 (P03) — 목록·schema·검증이 같은 스냅샷을 보고, 웹 설정 키와 어긋나지 않는다(T07).
 */
import { CAPABILITY_LIMITS, PLANNABLE_CAPABILITIES, ASSIGNABLE_CAPABILITIES } from '../../config/capabilities';
import { getCapabilityRegistry, resetCapabilityRuntimeForTest, snapshotForExecution } from '../../runtime-ports/capability-runtime';
import { ensureLegacyCapabilityBridge, resetLegacyCapabilityBridgeForTest, LEGACY_BRIDGE_CAPABILITIES } from '../../addon-host/legacy-capability-bridge';
import { planJsonSchemaFor, plannerCapabilityLines } from '../plan-schema';
import { PLAN_JSON_SCHEMA, validatePlan } from '../../services/orchestrator/plan-schema';

beforeEach(() => { resetCapabilityRuntimeForTest(); resetLegacyCapabilityBridgeForTest(); ensureLegacyCapabilityBridge(); });

describe('ExecutionSnapshot', () => {
    it('plannable 집합·프롬프트 목록·schema 인자 키가 한 스냅샷에서 나온다', () => {
        const snap = snapshotForExecution();
        // Base bridge 만 선 상태 — image.* 는 image-runtime add-on 소유라 여기 없다(P04)
        const basePlannable = PLANNABLE_CAPABILITIES.filter(c => LEGACY_BRIDGE_CAPABILITIES.includes(c));
        expect([...snap.plannable].sort()).toEqual([...basePlannable].sort());
        expect(snap.plannable.has('image.generate')).toBe(false);
        const lines = plannerCapabilityLines(snap);
        for (const id of basePlannable) expect(lines).toContain(`- ${id}: `);
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
        for (const id of ASSIGNABLE_CAPABILITIES.filter(c => LEGACY_BRIDGE_CAPABILITIES.includes(c))) {
            const def = snap.capabilities.find(e => e.definition.id === id)!.definition;
            const keys = Object.keys((def.settingsSchema as { properties: Record<string, unknown> }).properties);
            expect(keys.sort()).toEqual([...CAPABILITY_LIMITS.PARAM_KEYS[id]].sort());
        }
    });

    it('소유 add-on 이 게시·회수되면 같은 요청의 목록·schema·검증에서 함께 나타나고 사라진다(T02)', () => {
        const registry = getCapabilityRegistry();
        const before = registry.revision;
        // 미디어 add-on 이 켜진 배포를 흉내: 별도 소유자가 image.generate 를 게시
        const tx = registry.beginRegistration({ addonId: 'test-media', addonVersion: '1.0.0', source: 'builtin' });
        tx.register({ ...snapshotForExecution().capabilities[0].definition, id: 'image.generate', plannable: true, display: { label: 'img', group: 'image', order: 20 }, plannerHint: 'draw' }, { execute: async () => ({ ok: true, text: '', media: [] }) });
        tx.commit(['image.generate']);
        const withImage = snapshotForExecution();
        expect(withImage.plannable.has('image.generate')).toBe(true);
        expect(plannerCapabilityLines(withImage)).toContain('- image.generate: ');
        expect(validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'image.generate', input: { instruction: 'x' } }] }, new Set(), withImage.plannable).ok).toBe(true);

        // add-on OFF(회수) — 목록·검증에서 동시에 사라진다
        registry.unregisterOwner('test-media');
        const withoutImage = snapshotForExecution();
        expect(withoutImage.plannable.has('image.generate')).toBe(false);
        expect(plannerCapabilityLines(withoutImage)).not.toContain('image.generate');
        const r = validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'image.generate', input: { instruction: 'x' } }] }, new Set(), withoutImage.plannable);
        expect(r.ok).toBe(false);
        expect((r as { reason: string }).reason).toMatch(/not plannable/);
        expect(withoutImage.registryRevision).toBeGreaterThan(before);
    });
});
