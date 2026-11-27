/**
 * 확장 원본 정책(M2) — 순수 매처·판정·정책 해석(fail-closed) 고정.
 */
import { resetConfig } from '../../../config/env';
import {
    normalizeSourceUrl,
    describeExtensionSource,
    evaluateExtensionSource,
    loadExtensionSourceGate,
    assertExtensionSourceAllowed,
    resetExtensionSourcePolicyState,
    type ExtensionSourcePolicyDeps,
    type CatalogRef,
} from '../source-policy';
import { parseExtensionSourcePolicy, extensionSourcePolicyProblems, type ExtensionSourcePolicyLayer, type ExtensionSourceRule } from '../../../config/extension-source-policy';
import { parseOrgPolicyRows } from '../../org/effective-policy';
import { ExtensionSourceBlockedError } from '../../../errors/extension-source-blocked.error';

const KEYS = ['EXTENSION_SOURCE_POLICY_ENFORCED', 'EXTENSION_ARBITRARY_URL_INSTALL', 'EXTENSION_SOURCE_POLICY'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
    resetExtensionSourcePolicyState();
});

const layer = (p: { allow?: ExtensionSourceRule[]; deny?: ExtensionSourceRule[] }, scope: 'global' | 'organization' = 'global'): ExtensionSourcePolicyLayer =>
    ({ ...(p.allow ? { allow: p.allow } : {}), deny: p.deny ?? [], scope });

function verdict(url: string, layers: ExtensionSourcePolicyLayer[], opts: { ref?: string; action?: 'install' | 'entry' | 'catalog-sync'; catalogs?: CatalogRef[]; mode?: 'allow' | 'catalog-only' } = {}) {
    const source = describeExtensionSource(url, { ref: opts.ref });
    if (!source) throw new Error(`식별 불가: ${url}`);
    return evaluateExtensionSource({ source, action: opts.action ?? 'install', layers, catalogs: opts.catalogs ?? [], arbitraryUrlInstall: opts.mode ?? 'allow' });
}

describe('normalizeSourceUrl', () => {
    it.each([
        ['https://GitHub.com/Owner/Repo.git/', 'https://github.com/Owner/Repo'],
        ['ssh://git@github.com/owner/repo.git', 'https://github.com/owner/repo'],
        ['git@github.com:owner/repo.git', 'https://github.com/owner/repo'],
        ['git+https://user:pw@Example.COM:8443/a/b.zip#frag', 'https://example.com/a/b.zip'],
    ])('%s → %s', (raw, expected) => {
        expect(normalizeSourceUrl(raw)).toBe(expected);
    });
});

describe('describeExtensionSource — 설치 엔진과 같은 원본 식별', () => {
    it('GitHub 저장소는 소문자 owner/repo, HEAD 는 ref 없음', () => {
        expect(describeExtensionSource('https://github.com/OpenMake/Pack', { ref: 'HEAD' })).toMatchObject({ kind: 'github', repo: 'openmake/pack' });
        expect(describeExtensionSource('openmake/pack', { ref: 'v1' })).toMatchObject({ kind: 'github', repo: 'openmake/pack', ref: 'v1' });
    });
    it('.zip 은 비-git(기본), gitFirst 면 GitHub 우선(GitIngestService 단독 경로 순서)', () => {
        const zip = 'https://github.com/a/b/archive/main.zip';
        expect(describeExtensionSource(zip)?.kind).toBe('archive');
        expect(describeExtensionSource(zip, { gitFirst: true })?.kind).toBe('github');
    });
    it('internal·local·판정 불가', () => {
        expect(describeExtensionSource('internal://bundle/x1')?.kind).toBe('internal');
        expect(describeExtensionSource('local://packs/a')?.kind).toBe('local');
        expect(describeExtensionSource('not a url')).toBeNull();
    });
});

describe('evaluateExtensionSource — deny 는 넓게', () => {
    const deny = (rule: ExtensionSourceRule) => [layer({ deny: [rule] })];
    it.each([
        'https://github.com/Evil/Pack',
        'https://github.com/evil/pack.git',
        'https://github.com/evil/pack/',
        'ssh://git@github.com/evil/pack.git',
        'git@github.com:evil/pack.git',
        'evil/pack',
    ])('github 규칙이 정규화 우회 %s 를 막는다', (url) => {
        expect(verdict(url, deny({ type: 'github', repo: 'evil/pack' }))).toMatchObject({ allowed: false, reason: 'DENIED' });
    });
    it('git 규칙(url)과 github 규칙은 같은 저장소를 가리킨다', () => {
        expect(verdict('evil/pack', deny({ type: 'git', url: 'git@GITHUB.com:Evil/Pack.git' }))).toMatchObject({ allowed: false });
    });
    it('ref·path 없는 deny 는 모든 ref 를, ref 있는 deny 는 그 ref 와 HEAD 를 막는다', () => {
        expect(verdict('evil/pack', deny({ type: 'github', repo: 'evil/pack' }), { ref: 'v9' }).allowed).toBe(false);
        expect(verdict('evil/pack', deny({ type: 'github', repo: 'evil/pack', ref: 'bad' }), { ref: 'bad' }).allowed).toBe(false);
        expect(verdict('evil/pack', deny({ type: 'github', repo: 'evil/pack', ref: 'bad' })).allowed).toBe(false);   // HEAD — 알 수 없으면 막는다
        expect(verdict('evil/pack', deny({ type: 'github', repo: 'evil/pack', ref: 'bad' }), { ref: 'good' }).allowed).toBe(true);
    });
    it('owner 와일드카드', () => {
        expect(verdict('evil/anything', deny({ type: 'github', repo: 'evil/*' })).allowed).toBe(false);
        expect(verdict('good/anything', deny({ type: 'github', repo: 'evil/*' })).allowed).toBe(true);
    });
    it('hostPattern 은 정규식', () => {
        expect(verdict('https://files.evil.example/a.zip', deny({ type: 'hostPattern', pattern: '(^|\\.)evil\\.example$' })).allowed).toBe(false);
        expect(verdict('https://good.example/a.zip', deny({ type: 'hostPattern', pattern: '(^|\\.)evil\\.example$' })).allowed).toBe(true);
    });
    it('archive deny 는 스킴·query 를 무시한다', () => {
        expect(verdict('http://x.example/a.zip?token=1', deny({ type: 'archive', url: 'https://X.example/a.zip' })).allowed).toBe(false);
    });
    it('allow 와 deny 에 모두 걸리면 차단', () => {
        const l = [layer({ allow: [{ type: 'github', repo: 'evil/pack' }], deny: [{ type: 'github', repo: 'evil/*' }] })];
        expect(verdict('evil/pack', l)).toMatchObject({ allowed: false, reason: 'DENIED' });
    });
});

describe('evaluateExtensionSource — allow 는 정확히, 층마다', () => {
    it('allow 미설정 = 제한 없음, allow: [] = 전부 차단', () => {
        expect(verdict('any/repo', [layer({})]).allowed).toBe(true);
        expect(verdict('any/repo', [layer({ allow: [] })])).toMatchObject({ allowed: false, reason: 'NOT_ALLOWED' });
    });
    it('ref 는 정확 일치(양쪽 다 없음 포함)', () => {
        const l = [layer({ allow: [{ type: 'github', repo: 'openmake/pack' }] })];
        expect(verdict('openmake/pack', l).allowed).toBe(true);
        expect(verdict('openmake/pack', l, { ref: 'v2' }).allowed).toBe(false);
        expect(verdict('openmake/pack', [layer({ allow: [{ type: 'github', repo: 'openmake/pack', ref: 'v2' }] })], { ref: 'v2' }).allowed).toBe(true);
    });
    it('전역·조직 둘 다 allow 면 두 층 모두에서 일치해야 한다', () => {
        const g = layer({ allow: [{ type: 'github', repo: 'openmake/*' }] }, 'global');
        const o = layer({ allow: [{ type: 'github', repo: 'openmake/pack' }] }, 'organization');
        expect(verdict('openmake/pack', [g, o]).allowed).toBe(true);
        expect(verdict('openmake/other', [g, o])).toMatchObject({ allowed: false, scope: 'organization' });
    });
    it('internal·local 은 해당 종류 규칙만 허용한다', () => {
        const l = [layer({ allow: [{ type: 'internal' }] })];
        expect(verdict('internal://bundle/b1', l).allowed).toBe(true);
        expect(verdict('local://x', l).allowed).toBe(false);
    });
    it('catalog 규칙은 카탈로그 원본 자체에만 — 교차 저장소 항목(entry)은 독립 검사', () => {
        const catalogs = [{ id: 'cat1', url: 'https://github.com/openmake/openmake-marketplace' }];
        const l = [layer({ allow: [{ type: 'catalog', id: 'cat1' }] })];
        expect(verdict('openmake/openmake-marketplace', l, { catalogs }).allowed).toBe(true);
        expect(verdict('elsewhere/plugin', l, { catalogs, action: 'entry' }).allowed).toBe(false);
        expect(verdict('openmake/openmake-marketplace', l, { catalogs, action: 'entry' }).allowed).toBe(false);
    });
});

describe('evaluateExtensionSource — catalog-only', () => {
    const catalogs: CatalogRef[] = [{ id: 'c', url: 'https://github.com/openmake/market', plugins: [{ source: 'https://github.com/third/plugin' }] }];
    it('등록 카탈로그 URL·그 항목 원본만 설치, 임의 URL 거절', () => {
        expect(verdict('openmake/market', [], { catalogs, mode: 'catalog-only' }).allowed).toBe(true);
        expect(verdict('https://github.com/Third/Plugin.git', [], { catalogs, mode: 'catalog-only' }).allowed).toBe(true);
        expect(verdict('random/repo', [], { catalogs, mode: 'catalog-only' })).toMatchObject({ allowed: false, reason: 'CATALOG_ONLY' });
        expect(verdict('https://x.example/a.zip', [], { catalogs, mode: 'catalog-only' }).allowed).toBe(false);
    });
    it('마켓 항목(entry)·카탈로그 동기화·내부 게시는 대상이 아니다', () => {
        expect(verdict('random/repo', [], { catalogs, mode: 'catalog-only', action: 'entry' }).allowed).toBe(true);
        expect(verdict('random/repo', [], { catalogs, mode: 'catalog-only', action: 'catalog-sync' }).allowed).toBe(true);
        expect(verdict('internal://bundle/b', [], { catalogs, mode: 'catalog-only' }).allowed).toBe(true);
    });
});

describe('정책 값 파싱 — 깨진 값은 전부 차단', () => {
    it('스키마 불일치 → allow: [] + broken, 판정 사유 POLICY_INVALID', () => {
        const l = parseExtensionSourcePolicy({ allow: [{ type: 'github', repo: 'not a repo' }] }, 'organization');
        expect(l).toMatchObject({ allow: [], broken: true });
        expect(verdict('openmake/pack', [l])).toMatchObject({ allowed: false, reason: 'POLICY_INVALID' });
    });
    it('저장 검증은 문제 목록을 돌려준다(정규식·JSON)', () => {
        expect(extensionSourcePolicyProblems('{"deny":[{"type":"hostPattern","pattern":"("}]}').length).toBeGreaterThan(0);
        expect(extensionSourcePolicyProblems('nope')).toEqual(['JSON 이 아닙니다']);
        expect(extensionSourcePolicyProblems('{"allow":[]}')).toEqual([]);
    });
    it('조직 정책 행: 깨진 EXTENSION_SOURCE_POLICY 는 버리지 않고 전부 차단 층으로 남긴다', () => {
        expect(parseOrgPolicyRows([{ key: 'EXTENSION_SOURCE_POLICY', value: { allow: 'x' } }]).extensionSource).toMatchObject({ allow: [], broken: true, scope: 'organization' });
        expect(parseOrgPolicyRows([{ key: 'EXTENSION_SOURCE_POLICY', value: { deny: [{ type: 'internal' }] } }]).extensionSource).toEqual({ deny: [{ type: 'internal' }], scope: 'organization' });
    });
    it('전역 설정 JSON 이 깨지면 전부 차단 층', async () => {
        process.env.EXTENSION_SOURCE_POLICY_ENFORCED = 'true'; resetConfig();
        process.env.EXTENSION_SOURCE_POLICY = '{not json'; resetConfig();
        const gate = await loadExtensionSourceGate('u1', deps());
        expect(gate!.evaluate({ url: 'openmake/pack', action: 'install' })).toMatchObject({ allowed: false, reason: 'POLICY_INVALID', scope: 'global' });
    });
});

function deps(over: Partial<ExtensionSourcePolicyDeps> = {}): ExtensionSourcePolicyDeps & { audit: jest.Mock; loadCatalogs: jest.Mock } {
    return {
        loadOrgLayer: jest.fn(async () => undefined),
        loadCatalogs: jest.fn(async () => []),
        audit: jest.fn(async () => undefined),
        ...over,
    } as ExtensionSourcePolicyDeps & { audit: jest.Mock; loadCatalogs: jest.Mock };
}

describe('정책 해석 — 플래그·fail-closed·감사', () => {
    it('ENFORCED OFF 면 정책이 있어도 조회·판정하지 않는다(종전 동작)', async () => {
        process.env.EXTENSION_SOURCE_POLICY = '{"allow":[]}'; resetConfig();
        const d = deps();
        expect(await loadExtensionSourceGate('u1', d)).toBeNull();
        await expect(assertExtensionSourceAllowed({ url: 'any/repo', userId: 'u1', action: 'install' }, d)).resolves.toBeUndefined();
        expect(d.loadOrgLayer).not.toHaveBeenCalled();
    });

    it('ON + 거절 → 감사 기록 후 403 EXTENSION_SOURCE_BLOCKED(사유·규칙)', async () => {
        process.env.EXTENSION_SOURCE_POLICY_ENFORCED = 'true'; resetConfig();
        const d = deps({ loadOrgLayer: async () => layer({ deny: [{ type: 'github', repo: 'evil/*' }] }, 'organization') });
        const err = await assertExtensionSourceAllowed({ url: 'evil/x', userId: 'u1', action: 'install' }, d).catch((e) => e);
        expect(err).toBeInstanceOf(ExtensionSourceBlockedError);
        expect(err).toMatchObject({ statusCode: 403, code: 'EXTENSION_SOURCE_BLOCKED', detail: { reason: 'DENIED', scope: 'organization', rule: { type: 'github', repo: 'evil/*' } } });
        expect(err.message).toMatch(/^EXTENSION_SOURCE_BLOCKED: /);
        expect(d.audit).toHaveBeenCalledWith('u1', 'install', expect.objectContaining({ reason: 'DENIED' }));
    });

    it('조직 정책 조회 실패: 적용 이력이 없으면 거절, 있으면 마지막 정책 유지', async () => {
        process.env.EXTENSION_SOURCE_POLICY_ENFORCED = 'true'; resetConfig();
        const fail = deps({ loadOrgLayer: async () => { throw new Error('db down'); } });
        expect((await loadExtensionSourceGate('u1', fail))!.evaluate({ url: 'good/x', action: 'install' })).toMatchObject({ allowed: false, reason: 'POLICY_UNAVAILABLE' });

        const ok = deps({ loadOrgLayer: async () => layer({ deny: [{ type: 'github', repo: 'evil/*' }] }, 'organization') });
        await loadExtensionSourceGate('u2', ok);   // 적용 이력
        const gate = (await loadExtensionSourceGate('u2', fail))!;
        expect(gate.evaluate({ url: 'good/x', action: 'install' }).allowed).toBe(true);
        expect(gate.evaluate({ url: 'evil/x', action: 'install' })).toMatchObject({ allowed: false, reason: 'DENIED' });
    });

    it('카탈로그 목록은 필요할 때만 읽고, 실패하면 등록 원본 없음(더 제한적)', async () => {
        process.env.EXTENSION_SOURCE_POLICY_ENFORCED = 'true'; resetConfig();
        const d = deps();
        await loadExtensionSourceGate('u1', d);
        expect(d.loadCatalogs).not.toHaveBeenCalled();
        process.env.EXTENSION_ARBITRARY_URL_INSTALL = 'catalog-only'; resetConfig();
        const failing = deps({ loadCatalogs: jest.fn(async () => { throw new Error('db'); }) });
        const gate = (await loadExtensionSourceGate('u1', failing))!;
        expect(gate.evaluate({ url: 'openmake/market', action: 'install' })).toMatchObject({ allowed: false, reason: 'CATALOG_ONLY' });
    });

    it('식별 불가 URL 은 판정하지 않는다(설치 엔진이 INVALID_GIT_URL 로 네트워크 전에 거절)', async () => {
        process.env.EXTENSION_SOURCE_POLICY_ENFORCED = 'true'; resetConfig();
        process.env.EXTENSION_SOURCE_POLICY = '{"allow":[]}'; resetConfig();
        expect((await loadExtensionSourceGate('u1', deps()))!.evaluate({ url: '???', action: 'install' }).allowed).toBe(true);
    });
});
