import { zipSync, strToU8 } from 'fflate';
import { ArchiveFetcher, isArchiveUrl, archivePseudoRepo } from '../archive-fetcher';
import { safeFetch } from '../../../security/ssrf-guard';

jest.mock('../../../security/ssrf-guard', () => ({ safeFetch: jest.fn() }));

const LIMITS = { maxArchiveBytes: 1024 * 1024, maxEntries: 100, maxTotalBytes: 5 * 1024 * 1024 };

function mockZipResponse(files: Record<string, string>, contentLength?: number) {
    const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([p, c]) => [p, strToU8(c)])));
    (safeFetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => String(contentLength ?? zipped.byteLength) },
        arrayBuffer: async () => zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength),
    });
    return zipped;
}

describe('isArchiveUrl / archivePseudoRepo', () => {
    it('.zip URL 판별 (query 허용, git URL 은 미판별)', () => {
        expect(isArchiveUrl('https://example.com/ext.zip')).toBe(true);
        expect(isArchiveUrl('https://example.com/ext.zip?token=abc')).toBe(true);
        expect(isArchiveUrl('https://github.com/owner/repo')).toBe(false);
        expect(isArchiveUrl('owner/repo')).toBe(false);
        expect(isArchiveUrl('ftp://example.com/ext.zip')).toBe(false);
    });

    it('pseudo repo 는 URL 별 안정 값', () => {
        const a = archivePseudoRepo('https://example.com/ext.zip');
        expect(a.owner).toBe('archive');
        expect(archivePseudoRepo('https://example.com/ext.zip')).toEqual(a);
        expect(archivePseudoRepo('https://example.com/other.zip')).not.toEqual(a);
    });
});

describe('ArchiveFetcher', () => {
    beforeEach(() => jest.clearAllMocks());

    it('listTree/fetchFile — 공통 최상위 디렉토리 1겹 제거', async () => {
        mockZipResponse({
            'my-ext-main/plugin.json': '{"name":"p","version":"1.0.0"}',
            'my-ext-main/skills/a/SKILL.md': '---\nname: a\ndescription: d\n---\nbody text here',
        });
        const f = new ArchiveFetcher('https://example.com/ext.zip', LIMITS);
        const tree = await f.listTree('x', 'y', 'z');
        expect(tree.entries.map(e => e.path).sort()).toEqual(['plugin.json', 'skills/a/SKILL.md']);
        const content = await f.fetchFile('x', 'y', 'z', 'plugin.json');
        expect(JSON.parse(content).name).toBe('p');
    });

    it('resolveRef — 아카이브 sha256 (64 hex), 반복 호출 시 재다운로드 없음', async () => {
        mockZipResponse({ 'plugin.json': '{}' });
        const f = new ArchiveFetcher('https://example.com/ext.zip', LIMITS);
        const sha1 = await f.resolveRef('x', 'y', 'HEAD');
        const sha2 = await f.resolveRef('x', 'y', 'HEAD');
        expect(sha1).toMatch(/^[a-f0-9]{64}$/);
        expect(sha1).toBe(sha2);
        expect((safeFetch as jest.Mock).mock.calls.length).toBe(1);
    });

    it('zip-slip 엔트리 제외', async () => {
        mockZipResponse({
            'plugin.json': '{}',
            '../evil.txt': 'x',
        });
        const f = new ArchiveFetcher('https://example.com/ext.zip', LIMITS);
        const tree = await f.listTree('x', 'y', 'z');
        expect(tree.entries.map(e => e.path)).toEqual(['plugin.json']);
    });

    it('content-length 상한 초과 → ARCHIVE_TOO_LARGE', async () => {
        mockZipResponse({ 'plugin.json': '{}' }, LIMITS.maxArchiveBytes + 1);
        const f = new ArchiveFetcher('https://example.com/ext.zip', LIMITS);
        await expect(f.resolveRef('x', 'y', 'HEAD')).rejects.toThrow('ARCHIVE_TOO_LARGE');
    });

    it('없는 파일 → ARCHIVE_FILE_NOT_FOUND, 파일 크기 상한 → ARCHIVE_FILE_TOO_LARGE', async () => {
        mockZipResponse({ 'plugin.json': '{"name":"p"}' });
        const f = new ArchiveFetcher('https://example.com/ext.zip', LIMITS);
        await expect(f.fetchFile('x', 'y', 'z', 'nope.json')).rejects.toThrow('ARCHIVE_FILE_NOT_FOUND');
        await expect(f.fetchFile('x', 'y', 'z', 'plugin.json', 3)).rejects.toThrow('ARCHIVE_FILE_TOO_LARGE');
    });

    it('HTTP 실패 → ARCHIVE_FETCH_FAIL', async () => {
        (safeFetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 404, headers: { get: () => '0' } });
        const f = new ArchiveFetcher('https://example.com/ext.zip', LIMITS);
        await expect(f.resolveRef('x', 'y', 'HEAD')).rejects.toThrow('ARCHIVE_FETCH_FAIL');
    });
});
