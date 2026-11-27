/**
 * 이름 설치 `플러그인@마켓플레이스` (M5) — 문자 규칙·예약 별칭·해석·후보 안내(자동 치환 없음)·별칭 기본값.
 */
import {
    parseNamedInstallRef,
    isValidMarketplaceAlias,
    isValidInstallName,
} from '../../../config/extension-named-install';
import { resolveNamedInstall, resolveNamedInstallFrom, effectiveAliases, NamedInstallError } from '../named-install';
import { applyDefaultCatalogAlias } from '../catalog-alias';
import { EXTENSION_IMPORT_INTENT_PATTERNS } from '../../../config/runtime-limits-services';
import type { ExtensionCatalogRow } from '../../../data/repositories/extension-catalog-repository';

function src(over: Partial<ExtensionCatalogRow>): ExtensionCatalogRow {
    return {
        id: 's', url: 'https://github.com/acme/market', name: 'acme', description: null,
        plugins: [{ name: 'code-review' }, { name: 'code-format' }, { name: 'lint' }],
        enabled: true, added_by: null, last_synced_at: new Date(0), created_at: new Date(0), updated_at: new Date(0),
        alias: null, source_subpath: null, ...over,
    };
}

describe('이름 규칙', () => {
    it.each([
        ['code-review@openmake-marketplace', { plugin: 'code-review', marketplace: 'openmake-marketplace' }],
        ['a.b_c@m1', { plugin: 'a.b_c', marketplace: 'm1' }],
    ])('형식 OK: %s', (raw, expected) => expect(parseNamedInstallRef(raw)).toEqual(expected));

    it.each([
        'https://github.com/a/b', 'acme/market', 'git@github.com:a/b', '-x@m', 'x@-m', 'a..b@m', 'x@m..n',
        'x@m@n', 'x @m', '@m', 'x@', '', '한글@m',
    ])('형식 아님: %s', (raw) => expect(parseNamedInstallRef(raw)).toBeNull());

    it('예약 별칭(internal·builtin·local)은 대소문자 무관 거절', () => {
        expect(isValidMarketplaceAlias('internal')).toBe(false);
        expect(isValidMarketplaceAlias('Builtin')).toBe(false);
        expect(isValidMarketplaceAlias('LOCAL')).toBe(false);
        expect(isValidMarketplaceAlias('local-team')).toBe(true);
        expect(isValidInstallName('x'.repeat(121))).toBe(false);
    });
});

describe('resolveNamedInstallFrom', () => {
    it('별칭 → 원본 URL·플러그인·하위 경로', () => {
        const t = resolveNamedInstallFrom('code-review@team', [src({ id: 'a', alias: 'team', source_subpath: 'cat' })]);
        expect(t).toEqual({ sourceId: 'a', marketplace: 'team', gitUrl: 'https://github.com/acme/market', plugin: 'code-review', catalogSubpath: 'cat' });
    });

    it('별칭이 비면 스냅샷 name 으로 잡힌다', () => {
        expect(resolveNamedInstallFrom('lint@acme', [src({ id: 'a' })]).sourceId).toBe('a');
    });

    it('명시 별칭이 다른 원본의 name 기본값보다 우선한다', () => {
        const rows = [src({ id: 'explicit', alias: 'acme', url: 'https://github.com/x/y' }), src({ id: 'byname', name: 'acme' })];
        expect(resolveNamedInstallFrom('lint@acme', rows).sourceId).toBe('explicit');
        expect(effectiveAliases(rows).get('acme')).toHaveLength(1);
    });

    it('같은 name 의 무별칭 원본이 둘이면 모호 — 추측하지 않는다', () => {
        const rows = [src({ id: 'a', url: 'u1' }), src({ id: 'b', url: 'u2' })];
        expect(() => resolveNamedInstallFrom('lint@acme', rows)).toThrow('NAMED_INSTALL_AMBIGUOUS_MARKETPLACE');
    });

    it('비활성 원본은 대상이 아니다', () => {
        expect(() => resolveNamedInstallFrom('lint@acme', [src({ enabled: false })])).toThrow('NAMED_INSTALL_UNKNOWN_MARKETPLACE');
    });

    it('모르는 플러그인 — 후보만(전체 이름 형식), 자동 치환 없음', () => {
        const err = (() => { try { resolveNamedInstallFrom('code-revew@acme', [src({})]); } catch (e) { return e; } })() as NamedInstallError;
        expect(err).toBeInstanceOf(NamedInstallError);
        expect(err.code).toBe('NAMED_INSTALL_UNKNOWN_PLUGIN');
        expect(err.candidates[0]).toBe('code-review@acme');
        expect(err.message).toContain('code-review@acme');
    });

    it('모르는 마켓플레이스 — 등록된 별칭 후보', () => {
        const err = (() => { try { resolveNamedInstallFrom('lint@acm', [src({})]); } catch (e) { return e; } })() as NamedInstallError;
        expect(err.code).toBe('NAMED_INSTALL_UNKNOWN_MARKETPLACE');
        expect(err.candidates).toEqual(['lint@acme']);
    });

    it('예약어 name 은 기본 별칭이 되지 않는다', () => {
        expect(() => resolveNamedInstallFrom('lint@internal', [src({ name: 'internal' })])).toThrow('NAMED_INSTALL_UNKNOWN_MARKETPLACE');
    });

    it('형식 오류는 DB 를 읽지 않는다', async () => {
        const repo = { listEnabled: jest.fn() };
        await expect(resolveNamedInstall('https://github.com/a/b', repo)).rejects.toThrow('NAMED_INSTALL_INVALID');
        expect(repo.listEnabled).not.toHaveBeenCalled();
    });
});

describe('applyDefaultCatalogAlias', () => {
    it('비어 있으면 name 으로, 충돌이면 비워 둔다', async () => {
        const row = src({ id: 'a' });
        const ok = { setAlias: jest.fn(async () => ({ row: { ...row, alias: 'acme' }, conflict: false })) };
        expect((await applyDefaultCatalogAlias(ok, row)).alias).toBe('acme');
        expect(ok.setAlias).toHaveBeenCalledWith('a', 'acme', { onlyIfUnset: true });
        const clash = { setAlias: jest.fn(async () => ({ row: null, conflict: true })) };
        expect((await applyDefaultCatalogAlias(clash, row)).alias).toBeNull();
    });

    it('이미 별칭이 있거나 name 이 규칙 밖이면 건드리지 않는다', async () => {
        const repo = { setAlias: jest.fn() };
        await applyDefaultCatalogAlias(repo, src({ alias: 'x' }));
        await applyDefaultCatalogAlias(repo, src({ name: 'Local' }));
        await applyDefaultCatalogAlias(repo, src({ name: '팀 카탈로그' }));
        expect(repo.setAlias).not.toHaveBeenCalled();
    });
});

describe('설치 의도 게이트', () => {
    const hit = (m: string) => EXTENSION_IMPORT_INTENT_PATTERNS.some((re) => re.test(m));
    it('이름만 준 설치 요청도 도구를 노출한다', () => {
        expect(hit('code-review@team-catalog 설치해줘')).toBe(true);
        expect(hit('`lint@acme` install please')).toBe(true);
    });
    it('설치 동사 없는 이메일 문장은 잡지 않는다', () => {
        expect(hit('user@example.com 으로 메일 보내줘')).toBe(false);
    });
});
