import { COST_KINDS, COST_KIND_LIST, isCostKind } from '../cost-kinds';
describe('COST_KINDS', () => {
    test('모든 kind 에 unit 이 1개 이상', () => {
        for (const k of COST_KIND_LIST) expect(COST_KINDS[k].units.length).toBeGreaterThan(0);
    });
    test('isCostKind', () => { expect(isCostKind('llm.local')).toBe(true); expect(isCostKind('nope')).toBe(false); });
});
