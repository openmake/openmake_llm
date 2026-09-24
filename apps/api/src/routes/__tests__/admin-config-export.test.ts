/**
 * 구성 가져오기 검증 (F22 Phase E-1) — 시크릿 키·미지 키·정책 형식 오류를 dry-run 이 걸러낸다.
 */
import { validateImportedConfig, CONFIG_EXPORT_VERSION } from '../admin-config-export.routes';

const base = { version: CONFIG_EXPORT_VERSION as 1, systemSettings: {}, modelAssignments: [], capabilityModels: [], organizations: [] };

describe('validateImportedConfig', () => {
    test('빈 구성은 통과', () => {
        expect(validateImportedConfig(base)).toEqual([]);
    });
    test('시크릿·미지 설정 키는 거부', () => {
        const p = validateImportedConfig({ ...base, systemSettings: { GOOGLE_CLIENT_SECRET: 'x', NOT_A_KEY: 'y', EXTERNAL_MODEL_POLICY: '{"deny":["openrouter:*"]}' } });
        expect(p.some((x) => x.includes('GOOGLE_CLIENT_SECRET'))).toBe(true);
        expect(p.some((x) => x.includes('NOT_A_KEY'))).toBe(true);
        expect(p.some((x) => x.includes('EXTERNAL_MODEL_POLICY'))).toBe(false);
    });
    test('조직 slug 중복·정책 형식 오류 검출', () => {
        const p = validateImportedConfig({ ...base, organizations: [
            { slug: 'acme', name: 'A', monthlyTokenBudget: null, policies: { TOOL_APPROVAL_POLICY_MIN: 'bogus' } },
            { slug: 'acme', name: 'B', monthlyTokenBudget: null, policies: { UNKNOWN: 1 } },
        ] });
        expect(p).toEqual(expect.arrayContaining([
            expect.stringContaining('slug 중복'),
            expect.stringContaining('TOOL_APPROVAL_POLICY_MIN'),
            expect.stringContaining('UNKNOWN'),
        ]));
    });
});
