/**
 * 내부 번들 페처 — DB 번들이 git/zip 과 같은 fetcher 계약(resolveRef/listTree/fetchFile)으로 읽히는지.
 */
import { InternalBundleFetcher, isInternalBundleUrl, internalBundleId, isNonGitSourceUrl, nonGitPseudoRepo, INTERNAL_BUNDLE_PREFIX } from './internal-bundle-fetcher';
import { bundleSha } from '../../data/repositories/marketplace-bundle-repository';

const enc = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

describe('internal bundle url helpers', () => {
    it('internal://bundle/<id> 를 판별하고 id 를 뽑는다 (허용 문자 외 제거)', () => {
        expect(isInternalBundleUrl(`${INTERNAL_BUNDLE_PREFIX}bundle-abc`)).toBe(true);
        expect(isInternalBundleUrl('https://github.com/o/r')).toBe(false);
        expect(internalBundleId(`${INTERNAL_BUNDLE_PREFIX}bundle-abc/../x`)).toBe('bundle-abcx');
    });
    it('git 이 아닌 소스 판정은 zip 과 내부 번들 둘 다 잡고, pseudo repo 를 준다', () => {
        expect(isNonGitSourceUrl('https://x.test/a.zip')).toBe(true);
        expect(isNonGitSourceUrl(`${INTERNAL_BUNDLE_PREFIX}b1`)).toBe(true);
        expect(isNonGitSourceUrl('owner/repo')).toBe(false);
        expect(nonGitPseudoRepo(`${INTERNAL_BUNDLE_PREFIX}b1`)).toEqual({ owner: 'internal', repo: 'b1' });
    });
});

describe('InternalBundleFetcher', () => {
    const files = new Map<string, Uint8Array>([
        ['.claude-plugin/plugin.json', enc('{"name":"p"}')],
        ['skills/csv/SKILL.md', enc('---\nname: CSV\ndescription: d\n---\n본문')],
    ]);
    const loader = jest.fn(async (id: string) => (id === 'b1' ? { sha: 'deadbeef', files } : null));

    it('resolveRef 는 번들 sha, listTree 는 파일 목록, fetchFile 은 utf8 본문', async () => {
        const f = new InternalBundleFetcher(`${INTERNAL_BUNDLE_PREFIX}b1`, loader);
        expect(await f.resolveRef('internal', 'b1', 'HEAD')).toBe('deadbeef');
        const tree = await f.listTree('internal', 'b1', 'deadbeef');
        expect(tree.entries.map((e) => e.path).sort()).toEqual(['.claude-plugin/plugin.json', 'skills/csv/SKILL.md']);
        expect(await f.fetchFile('internal', 'b1', 'deadbeef', 'skills/csv/SKILL.md')).toContain('name: CSV');
        expect(loader).toHaveBeenCalledTimes(1); // 한 번 로드 후 캐시
    });
    it('없는 번들·없는 파일·크기 초과는 명시적 오류', async () => {
        await expect(new InternalBundleFetcher(`${INTERNAL_BUNDLE_PREFIX}nope`, loader).resolveRef('i', 'nope', 'HEAD')).rejects.toThrow(/NOT_FOUND/);
        const f = new InternalBundleFetcher(`${INTERNAL_BUNDLE_PREFIX}b1`, loader);
        await expect(f.fetchFile('i', 'b1', 's', 'missing.md')).rejects.toThrow(/FILE_NOT_FOUND/);
        await expect(f.fetchFile('i', 'b1', 's', 'skills/csv/SKILL.md', 5)).rejects.toThrow(/TOO_LARGE/);
    });
});

describe('bundleSha', () => {
    it('파일 순서와 무관하게 결정적이고, 내용이 바뀌면 달라진다', () => {
        const a = [{ path: 'a', content: 'x' }, { path: 'b', content: Buffer.from('y') }];
        const b = [{ path: 'b', content: Buffer.from('y') }, { path: 'a', content: 'x' }];
        expect(bundleSha(a)).toBe(bundleSha(b));
        expect(bundleSha([{ path: 'a', content: 'x2' }, { path: 'b', content: Buffer.from('y') }])).not.toBe(bundleSha(a));
    });
});
