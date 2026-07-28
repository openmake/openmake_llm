import { importFromGitSchema, parseGitUrl } from '../git-ingest.schema';

describe('importFromGitSchema', () => {
    it('accepts minimum input (gitUrl only)', () => {
        const r = importFromGitSchema.parse({ gitUrl: 'https://github.com/foo/bar' });
        expect(r.target).toBe('user');
    });
    it('accepts owner/repo short form', () => {
        const r = importFromGitSchema.parse({ gitUrl: 'foo/bar' });
        expect(r.gitUrl).toBe('foo/bar');
    });
    it('rejects empty gitUrl', () => {
        expect(() => importFromGitSchema.parse({ gitUrl: '' })).toThrow();
    });
    it('rejects gitUrl > 500 chars', () => {
        expect(() => importFromGitSchema.parse({ gitUrl: 'a'.repeat(501) })).toThrow();
    });
    it('rejects gitPath with .. (path traversal guard)', () => {
        expect(() => importFromGitSchema.parse({ gitUrl: 'foo/bar', gitPath: '../etc/passwd' })).toThrow();
    });
});

describe('parseGitUrl', () => {
    it.each([
        ['https://github.com/foo/bar', { owner: 'foo', repo: 'bar' }],
        ['https://github.com/foo/bar.git', { owner: 'foo', repo: 'bar' }],
        ['https://github.com/foo/bar/tree/main', { owner: 'foo', repo: 'bar' }],
        ['git@github.com:foo/bar.git', { owner: 'foo', repo: 'bar' }],
        ['foo/bar', { owner: 'foo', repo: 'bar' }],
    ])('parses %s', (url, expected) => {
        expect(parseGitUrl(url)).toEqual(expected);
    });
    it('returns null for invalid URL', () => {
        expect(parseGitUrl('not a url')).toBeNull();
    });
});
