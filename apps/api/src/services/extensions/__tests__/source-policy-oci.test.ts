/**
 * 확장 원본 정책(M2) — OCI 원본 규칙(P8, opt-in EXTENSION_OCI_INSTALL_ENABLED).
 * 레지스트리 호스트·저장소 접두 매칭, 정규화 우회 차단, 기존 Git 규칙 의미 불변, OFF 무변경.
 */
import { resetConfig } from '../../../config/env';
import { describeExtensionSource, evaluateExtensionSource, assertExtensionSourceAllowed, resetExtensionSourcePolicyState, type ExtensionSourcePolicyDeps } from '../source-policy';
import { extensionSourcePolicyProblems, type ExtensionSourcePolicyLayer, type ExtensionSourceRule } from '../../../config/extension-source-policy';
import { ExtensionSourceBlockedError } from '../../../errors/extension-source-blocked.error';

const KEYS = ['EXTENSION_OCI_INSTALL_ENABLED', 'EXTENSION_SOURCE_POLICY_ENFORCED', 'EXTENSION_SOURCE_POLICY', 'EXTENSION_ARBITRARY_URL_INSTALL'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function setEnv(k: typeof KEYS[number], v: string | undefined): void {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
    resetConfig();
}
beforeEach(() => setEnv('EXTENSION_OCI_INSTALL_ENABLED', 'true'));
afterEach(() => {
    for (const k of KEYS) setEnv(k, ORIGINAL[k]);
    resetExtensionSourcePolicyState();
});

const layer = (p: { allow?: ExtensionSourceRule[]; deny?: ExtensionSourceRule[] }): ExtensionSourcePolicyLayer =>
    ({ ...(p.allow ? { allow: p.allow } : {}), deny: p.deny ?? [], scope: 'global' });

function verdict(url: string, layers: ExtensionSourcePolicyLayer[], mode: 'allow' | 'catalog-only' = 'allow') {
    const source = describeExtensionSource(url);
    if (!source) throw new Error(`식별 불가: ${url}`);
    return evaluateExtensionSource({ source, action: 'install', layers, catalogs: [], arbitraryUrlInstall: mode });
}

describe('describeExtensionSource — OCI', () => {
    it('같은 파서로 정규화(태그·digest 는 식별 아님), github.com/ 이 경로에 있어도 GitHub 으로 오인하지 않는다', () => {
        expect(describeExtensionSource('oci://GHCR.io:443/org/plugin:v1')).toEqual({ kind: 'oci', registry: 'ghcr.io', host: 'ghcr.io', repository: 'org/plugin', url: 'oci://ghcr.io/org/plugin' });
        expect(describeExtensionSource(`oci://ghcr.io/org/plugin@sha256:${'c'.repeat(64)}`)).toMatchObject({ kind: 'oci', url: 'oci://ghcr.io/org/plugin' });
        expect(describeExtensionSource('oci://evil.example.com/github.com/openmake/x:v1', { gitFirst: true })).toMatchObject({ kind: 'oci', registry: 'evil.example.com' });
        expect(describeExtensionSource('oci://ghcr.io/Org/plugin:v1')).toBeNull();   // 문법 밖 = 원본 아님(설치도 거절)
    });

    it('OFF: oci:// 는 종전처럼 식별되지 않는다(정책이 판정하지 않음)', () => {
        setEnv('EXTENSION_OCI_INSTALL_ENABLED', undefined);
        expect(describeExtensionSource('oci://ghcr.io/org/plugin:v1')).toBeNull();
    });
});

describe('oci 규칙 매칭', () => {
    const allowOrg = layer({ allow: [{ type: 'oci', registry: 'ghcr.io', repository: 'openmake' }] });

    it('allow: 레지스트리 정확 + 저장소 구성요소 단위 접두', () => {
        expect(verdict('oci://ghcr.io/openmake:v1', [allowOrg]).allowed).toBe(true);
        expect(verdict('oci://ghcr.io/openmake/plugin:v1', [allowOrg]).allowed).toBe(true);
        expect(verdict('oci://ghcr.io/openmake/a/b:v1', [allowOrg]).allowed).toBe(true);
        expect(verdict('oci://ghcr.io/openmake-evil/plugin:v1', [allowOrg])).toMatchObject({ allowed: false, reason: 'NOT_ALLOWED' });
        expect(verdict('oci://ghcr.io.evil.com/openmake/plugin:v1', [allowOrg])).toMatchObject({ allowed: false, reason: 'NOT_ALLOWED' });
        expect(verdict('oci://ghcr.io:5000/openmake/plugin:v1', [allowOrg])).toMatchObject({ allowed: false });   // allow 는 포트까지 정확
    });

    it('정규화 우회 차단: 대소문자·:443·Docker Hub 별칭은 같은 원본', () => {
        const deny = layer({ deny: [{ type: 'oci', registry: 'docker.io', repository: 'library' }] });
        expect(verdict('oci://registry-1.docker.io/library/nginx:1', [deny])).toMatchObject({ allowed: false, reason: 'DENIED' });
        expect(verdict('oci://index.docker.io/nginx', [deny])).toMatchObject({ allowed: false, reason: 'DENIED' });
        const deny2 = layer({ deny: [{ type: 'oci', registry: 'GHCR.IO:443' }] });
        expect(verdict('oci://ghcr.io/x/y:v1', [deny2])).toMatchObject({ allowed: false, reason: 'DENIED' });
    });

    it('deny: 포트 없는 규칙은 그 호스트의 모든 포트를 막는다', () => {
        const deny = layer({ deny: [{ type: 'oci', registry: 'reg.example.com' }] });
        expect(verdict('oci://reg.example.com:5000/a/b:v1', [deny])).toMatchObject({ allowed: false, reason: 'DENIED' });
        expect(verdict('oci://other.example.com/a/b:v1', [deny]).allowed).toBe(true);
    });

    it('hostPattern 은 레지스트리 호스트에도 적용', () => {
        expect(verdict('oci://reg.evil.io/a/b:v1', [layer({ deny: [{ type: 'hostPattern', pattern: '\\.evil\\.io$' }] })])).toMatchObject({ allowed: false, reason: 'DENIED' });
    });

    it('기존 Git 규칙 의미 불변: github 규칙은 OCI 원본에 맞지 않고, oci 규칙은 Git 원본에 맞지 않는다', () => {
        expect(verdict('oci://ghcr.io/openmake/plugin:v1', [layer({ allow: [{ type: 'github', repo: 'openmake/*' }] })])).toMatchObject({ allowed: false, reason: 'NOT_ALLOWED' });
        expect(verdict('https://github.com/openmake/plugin', [allowOrg])).toMatchObject({ allowed: false, reason: 'NOT_ALLOWED' });
        expect(verdict('https://github.com/openmake/plugin', [layer({ allow: [{ type: 'github', repo: 'openmake/*' }], deny: [{ type: 'oci', registry: 'ghcr.io' }] })]).allowed).toBe(true);
    });

    it('catalog-only 는 OCI URL 입력도 막는다', () => {
        expect(verdict('oci://ghcr.io/openmake/plugin:v1', [], 'catalog-only')).toMatchObject({ allowed: false, reason: 'CATALOG_ONLY' });
    });

    it('스키마: 레지스트리·저장소 형식 검증', () => {
        expect(extensionSourcePolicyProblems(JSON.stringify({ allow: [{ type: 'oci', registry: 'ghcr.io', repository: 'openmake/' }] }))).toEqual([]);
        expect(extensionSourcePolicyProblems(JSON.stringify({ allow: [{ type: 'oci', registry: 'https://ghcr.io' }] })).length).toBeGreaterThan(0);
        expect(extensionSourcePolicyProblems(JSON.stringify({ allow: [{ type: 'oci', registry: 'ghcr.io', repository: 'Open/Make' }] })).length).toBeGreaterThan(0);
    });
});

describe('설치 진입부 — 네트워크 전에 거절', () => {
    const deps: ExtensionSourcePolicyDeps = { loadOrgLayer: async () => undefined, loadCatalogs: async () => [], audit: jest.fn(async () => undefined) };
    it('강제 ON + oci deny → 403 EXTENSION_SOURCE_BLOCKED', async () => {
        setEnv('EXTENSION_SOURCE_POLICY_ENFORCED', 'true');
        setEnv('EXTENSION_SOURCE_POLICY', JSON.stringify({ deny: [{ type: 'oci', registry: 'ghcr.io', repository: 'bad' }] }));
        await expect(assertExtensionSourceAllowed({ url: 'oci://ghcr.io/bad/x:v1', userId: 'u1', action: 'install' }, deps)).rejects.toBeInstanceOf(ExtensionSourceBlockedError);
        await expect(assertExtensionSourceAllowed({ url: 'oci://ghcr.io/good/x:v1', userId: 'u1', action: 'install' }, deps)).resolves.toBeUndefined();
    });
});
