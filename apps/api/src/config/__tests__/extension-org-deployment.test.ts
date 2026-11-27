/**
 * 조직 확장 배포 모드 해석 규칙(§8-1) — 그룹 덮어쓰기 > 항목 기본값, 여러 그룹이면 가장 강한 값.
 * 규칙은 config/extension-org-deployment `resolveDeploymentMode` 한 곳이다 — 바꾸면 여기가 먼저 깨진다.
 */
import { resetConfig } from '../env';
import {
    DEPLOYMENT_MODES,
    DEPLOYMENT_MODE_STRENGTH,
    extensionOrgDeploymentModesEnabled,
    isDeploymentMode,
    resolveDeploymentMode,
} from '../extension-org-deployment';

describe('resolveDeploymentMode', () => {
    test('설정이 없으면 default_off (종전 — 갤러리에만)', () => {
        expect(resolveDeploymentMode(null, [])).toBe('default_off');
        expect(resolveDeploymentMode(undefined, [])).toBe('default_off');
    });

    test.each(DEPLOYMENT_MODES)('그룹 덮어쓰기가 없으면 항목 기본값 %s', (m) => {
        expect(resolveDeploymentMode(m, [])).toBe(m);
    });

    test('그룹 덮어쓰기가 항목 기본값보다 우선한다 — 약하게 덮을 수도 있다', () => {
        expect(resolveDeploymentMode('required', ['default_off'])).toBe('default_off');
        expect(resolveDeploymentMode('default_off', ['default_on'])).toBe('default_on');
        expect(resolveDeploymentMode(null, ['required'])).toBe('required');
    });

    test('여러 그룹이면 가장 강한 값 (required > default_on > default_off), 순서 무관', () => {
        expect(resolveDeploymentMode('default_off', ['default_on', 'required', 'default_off'])).toBe('required');
        expect(resolveDeploymentMode('required', ['default_off', 'default_on'])).toBe('default_on');
        expect(resolveDeploymentMode('default_on', ['default_off', 'default_off'])).toBe('default_off');
    });

    test('강도 표', () => {
        expect(DEPLOYMENT_MODE_STRENGTH.required).toBeGreaterThan(DEPLOYMENT_MODE_STRENGTH.default_on);
        expect(DEPLOYMENT_MODE_STRENGTH.default_on).toBeGreaterThan(DEPLOYMENT_MODE_STRENGTH.default_off);
    });

    test('isDeploymentMode', () => {
        expect(isDeploymentMode('required')).toBe(true);
        expect(isDeploymentMode('on')).toBe(false);
        expect(isDeploymentMode(null)).toBe(false);
    });
});

describe('EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED', () => {
    const original = process.env.EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED;
    afterEach(() => {
        if (original === undefined) delete process.env.EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED;
        else process.env.EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED = original;
        resetConfig();
    });
    test('기본 OFF, "true" 만 켠다', () => {
        delete process.env.EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED; resetConfig();
        expect(extensionOrgDeploymentModesEnabled()).toBe(false);
        process.env.EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED = '1'; resetConfig();
        expect(extensionOrgDeploymentModesEnabled()).toBe(false);
        process.env.EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED = 'true'; resetConfig();
        expect(extensionOrgDeploymentModesEnabled()).toBe(true);
    });
});
