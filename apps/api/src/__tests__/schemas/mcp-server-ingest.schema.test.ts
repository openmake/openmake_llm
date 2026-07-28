/**
 * mcp-server-ingest.schema — REST 입력 검증.
 */
import {
    importMcpServerFromGitSchema,
    approveMcpServerDraftSchema,
} from '../../schemas/mcp-server-ingest.schema';

describe('mcp-server-ingest.schema', () => {
    describe('importMcpServerFromGitSchema', () => {
        test('gitUrl 만 있어도 통과', () => {
            const r = importMcpServerFromGitSchema.safeParse({
                gitUrl: 'https://github.com/foo/bar',
            });
            expect(r.success).toBe(true);
        });

        test('gitUrl 누락 시 거부', () => {
            const r = importMcpServerFromGitSchema.safeParse({});
            expect(r.success).toBe(false);
        });

        test('ftp:// URL 거부', () => {
            const r = importMcpServerFromGitSchema.safeParse({
                gitUrl: 'ftp://example.com/foo',
            });
            expect(r.success).toBe(false);
        });

        test('owner/repo 단축형 허용', () => {
            const r = importMcpServerFromGitSchema.safeParse({
                gitUrl: 'modelcontextprotocol/servers',
            });
            expect(r.success).toBe(true);
        });

        test('accessToken 길이 200자 초과 거부', () => {
            const r = importMcpServerFromGitSchema.safeParse({
                gitUrl: 'https://github.com/foo/bar',
                accessToken: 'a'.repeat(1000),
            });
            expect(r.success).toBe(false);
        });

        test('gitPath 길이 300자 초과 거부', () => {
            const r = importMcpServerFromGitSchema.safeParse({
                gitUrl: 'https://github.com/foo/bar',
                gitPath: 'a/'.repeat(200) + 'file.md',
            });
            expect(r.success).toBe(false);
        });

        test('gitPath path traversal 거부', () => {
            const r = importMcpServerFromGitSchema.safeParse({
                gitUrl: 'https://github.com/foo/bar',
                gitPath: '../etc/passwd',
            });
            expect(r.success).toBe(false);
        });
    });

    describe('approveMcpServerDraftSchema', () => {
        test('envOverrides 만 있으면 통과', () => {
            const r = approveMcpServerDraftSchema.safeParse({
                envOverrides: { DATABASE_URL: 'postgres://u@h/d' },
            });
            expect(r.success).toBe(true);
        });

        test('빈 객체 통과 (모두 optional)', () => {
            const r = approveMcpServerDraftSchema.safeParse({});
            expect(r.success).toBe(true);
        });

        test('enableImmediately false 통과', () => {
            const r = approveMcpServerDraftSchema.safeParse({
                enableImmediately: false,
            });
            expect(r.success).toBe(true);
        });

        test('envOverrides 값 2000자 초과 거부', () => {
            const r = approveMcpServerDraftSchema.safeParse({
                envOverrides: { KEY: 'a'.repeat(5000) },
            });
            expect(r.success).toBe(false);
        });
    });
});
