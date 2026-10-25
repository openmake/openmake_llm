/**
 * 업로드 매직 바이트 검사(E10) — 신고 MIME 과 파일 앞부분(PDF 는 앞 1024바이트 안 헤더)이 어긋나면 파서 전에 400 으로 거부한다.
 * 표에 없는 MIME(텍스트류)은 검사하지 않는다. 서비스 경로는 큐·DB·저장소·인가를 mock 하고 거부 시 저장이 일어나지 않는지 본다.
 */
const storeOriginal = jest.fn(async (_s: string, v: string) => v);
jest.mock('../documents/storage', () => ({
    contentHash: () => 'h'.repeat(64),
    storeOriginal: (s: string, v: string) => storeOriginal(s, v),
}));
jest.mock('../jobs/queue', () => ({ enqueueJob: jest.fn(async () => 'job-1') }));
const fakeClient = { query: jest.fn(async () => ({ rows: [], rowCount: 1 })) };
jest.mock('../db', () => ({
    kdb: () => fakeClient,
    inTransaction: async (fn: (c: typeof fakeClient) => Promise<unknown>) => fn(fakeClient),
}));
jest.mock('../config/scope-policy', () => ({
    actorFor: async (userId: string) => ({ userId, activeOrg: null, orgWriteRoles: [] }),
}));
jest.mock('../spaces/repository', () => ({
    getSpaceScopeRow: async () => ({ id: 's1', scope_type: 'user', scope_id: 'u-1', config_profile_id: null }),
    touchSpace: async () => undefined,
}));
jest.mock('../documents/repository', () => ({
    countLiveDocuments: async () => 0,
    hasLiveHash: async () => false,
    insertDocumentWithVersion: async () => undefined,
}));
jest.mock('../config/profiles', () => ({
    resolveSpaceProfiles: async () => ({
        limits: { allowedMimeTypes: ['application/pdf', 'text/plain'], maxFileBytes: 10_000, maxDocumentsPerSpace: 10, purgeAfterDays: 30 },
        chunker: { id: 'chunker-default' },
    }),
    getDefaultLimits: async () => ({ purgeAfterDays: 30 }),
}));

import { sniffMimeMismatch } from '../documents/magic-bytes';
import { uploadDocument } from '../documents/service';

const OOXML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('sniffMimeMismatch', () => {
    it('브리프 기준 3건', () => {
        expect(sniffMimeMismatch(Buffer.from('<html>'), 'application/pdf')).toBe(true);
        expect(sniffMimeMismatch(Buffer.from('%PDF-1.7'), 'application/pdf')).toBe(false);
        expect(sniffMimeMismatch(Buffer.from('abc'), 'text/plain')).toBe(false);
    });

    it('표의 각 MIME 은 맞는 매직이면 통과, 아니면 불일치', () => {
        const cases: Array<[string, Buffer]> = [
            [OOXML, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])],
            ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from('PK\x03\x04', 'latin1')],
            ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
            ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
            ['application/zip', Buffer.from('PK\x05\x06', 'latin1')],
        ];
        for (const [mime, head] of cases) {
            expect(sniffMimeMismatch(head, mime)).toBe(false);
            expect(sniffMimeMismatch(Buffer.from('<html>..'), mime)).toBe(true);
        }
        // OOXML 은 PK 다음 \x03\x04 까지 맞아야 한다
        expect(sniffMimeMismatch(Buffer.from('PK\x05\x06', 'latin1'), OOXML)).toBe(true);
    });

    it('표에 없는 MIME(markdown·csv·json·미지)은 검사하지 않는다', () => {
        for (const mime of ['text/markdown', 'text/csv', 'application/json', 'application/x-unknown']) {
            expect(sniffMimeMismatch(Buffer.from('\x00\x01binary', 'latin1'), mime)).toBe(false);
        }
    });

    it('PDF 는 앞 1024바이트 안 어디든 %PDF- 가 있으면 통과, 없으면 불일치(M-3)', () => {
        const bom = Buffer.from([0xef, 0xbb, 0xbf]);
        expect(sniffMimeMismatch(Buffer.concat([bom, Buffer.from('%PDF-1.7\n')]), 'application/pdf')).toBe(false);
        expect(sniffMimeMismatch(Buffer.from('   %PDF-1.4'), 'application/pdf')).toBe(false);
        expect(sniffMimeMismatch(Buffer.concat([Buffer.alloc(1000, 0x20), Buffer.from('%PDF-1.4')]), 'application/pdf')).toBe(false);
        expect(sniffMimeMismatch(Buffer.concat([Buffer.alloc(1100, 0x20), Buffer.from('%PDF-1.4')]), 'application/pdf')).toBe(true);
        expect(sniffMimeMismatch(Buffer.from('<html>no pdf header here</html>'), 'application/pdf')).toBe(true);
        // 다른 MIME 은 여전히 접두 비교 — 앞에 바이트가 붙으면 불일치
        expect(sniffMimeMismatch(Buffer.concat([bom, Buffer.from([0x89, 0x50, 0x4e, 0x47])]), 'image/png')).toBe(true);
    });

    it('매직보다 짧은 앞부분은 있는 바이트가 어긋날 때만 불일치', () => {
        expect(sniffMimeMismatch(Buffer.alloc(0), 'application/pdf')).toBe(false);
        expect(sniffMimeMismatch(Buffer.from('%PD'), 'application/pdf')).toBe(false);
        expect(sniffMimeMismatch(Buffer.from('<h'), 'application/pdf')).toBe(true);
    });
});

describe('uploadDocument 매직 바이트 거부', () => {
    beforeEach(() => storeOriginal.mockClear());

    it('PDF 로 신고했는데 내용이 HTML 이면 400, 저장하지 않는다', async () => {
        const buffer = Buffer.from('<html><script>alert(1)</script></html>');
        await expect(uploadDocument('u-1', 's1', { buffer, originalname: 'a.pdf', mimetype: 'application/pdf', size: buffer.length }))
            .rejects.toMatchObject({ statusCode: 400, message: '파일 내용이 형식과 일치하지 않습니다', code: 'FAILED_VALIDATION' });
        expect(storeOriginal).not.toHaveBeenCalled();
    });

    it('octet-stream 으로 와서 확장자로 PDF 가 된 경우도 같은 검사를 받는다', async () => {
        const buffer = Buffer.from('not a pdf at all');
        await expect(uploadDocument('u-1', 's1', { buffer, originalname: 'x.pdf', mimetype: 'application/octet-stream', size: buffer.length }))
            .rejects.toMatchObject({ statusCode: 400 });
        expect(storeOriginal).not.toHaveBeenCalled();
    });

    it('헤더 앞에 BOM·공백이 붙은 PDF 는 업로드된다(앞 1024바이트 안 %PDF-)', async () => {
        for (const pre of [Buffer.from([0xef, 0xbb, 0xbf]), Buffer.alloc(600, 0x20)]) {
            const pdf = Buffer.concat([pre, Buffer.from('%PDF-1.4\n...')]);
            await expect(uploadDocument('u-1', 's1', { buffer: pdf, originalname: 'b.pdf', mimetype: 'application/pdf', size: pdf.length }))
                .resolves.toMatchObject({ mimeType: 'application/pdf' });
        }
        expect(storeOriginal).toHaveBeenCalledTimes(2);
    });

    it('진짜 PDF 헤더와 텍스트 파일은 그대로 업로드된다', async () => {
        const pdf = Buffer.from('%PDF-1.4\n...');
        await expect(uploadDocument('u-1', 's1', { buffer: pdf, originalname: 'a.pdf', mimetype: 'application/pdf', size: pdf.length }))
            .resolves.toMatchObject({ mimeType: 'application/pdf' });
        const txt = Buffer.from('hello');
        await expect(uploadDocument('u-1', 's1', { buffer: txt, originalname: 'a.txt', mimetype: 'text/plain', size: txt.length }))
            .resolves.toMatchObject({ mimeType: 'text/plain' });
        expect(storeOriginal).toHaveBeenCalledTimes(2);
    });
});
