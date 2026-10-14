/**
 * 텍스트 첨부 디코딩 회귀 (2026-10-15).
 *
 * REST 클라이언트(디스코드 봇 등)는 files[] 에 텍스트 파일도 base64 data 로 보낸다. 추출기는 PDF·오피스·HWP 만
 * 다루고 나머지는 data 를 버려, sales.csv 같은 텍스트 파일이 "바이너리 메타"로만 들어갔다. 이 테스트는
 * 텍스트로 판정되는 파일을 UTF-8 로 풀어 content 로 쓰는 동작을 고정한다.
 */
import { extractAttachedDocuments, isTextAttachment } from '../doc-extractor';
import { FILE_ATTACH_LIMITS } from '../../../config/runtime-limits';

type Attached = { name: string; type?: string; data?: string; content?: string; truncated?: boolean; extracted?: boolean };

const b64 = (s: string | Buffer): string => (Buffer.isBuffer(s) ? s : Buffer.from(s, 'utf8')).toString('base64');

describe('doc-extractor — 텍스트 첨부 디코딩', () => {
    it('text/csv base64 는 디코딩한 CSV 본문을 content 로 쓰고 data 를 지운다', async () => {
        const csv = '지역,매출\n서울,100\n부산,80\n';
        const files: Attached[] = [{ name: 'sales.csv', type: 'text/csv', data: b64(csv) }];
        await extractAttachedDocuments(files as never);

        expect(files[0].content).toBe(csv);
        expect(files[0].data).toBeUndefined();
        expect(files[0].extracted).toBeUndefined();
        expect(files[0].truncated).toBeUndefined();
    });

    it('type 이 없어도 확장자(.md)로 텍스트를 판정해 content 를 채운다', async () => {
        const files: Attached[] = [{ name: 'notes.md', data: b64('# 제목\n\n본문') }];
        await extractAttachedDocuments(files as never);
        expect(files[0].content).toBe('# 제목\n\n본문');
        expect(files[0].data).toBeUndefined();
    });

    it('.bin·NUL 포함·UTF-8 깨짐은 content 없이 메타로 남긴다', async () => {
        const files: Attached[] = [
            { name: 'blob.bin', type: 'application/octet-stream', data: b64('plain text but bin') },
            { name: 'nul.txt', type: 'text/plain', data: b64(Buffer.from([0x61, 0x00, 0x62])) },
            { name: 'broken.csv', type: 'text/csv', data: b64(Buffer.from([0x61, 0xff, 0xfe, 0x62])) },
        ];
        await extractAttachedDocuments(files as never);
        for (const f of files) {
            expect(f.content).toBeUndefined();
            expect(f.data).toBeUndefined();
        }
    });

    it('MAX_CHARS_PER_FILE 를 넘으면 절단하고 truncated 를 붙인다', async () => {
        const long = 'a'.repeat(FILE_ATTACH_LIMITS.MAX_CHARS_PER_FILE + 10);
        const files: Attached[] = [{ name: 'big.txt', type: 'text/plain', data: b64(long) }];
        await extractAttachedDocuments(files as never);
        expect(files[0].content).toHaveLength(FILE_ATTACH_LIMITS.MAX_CHARS_PER_FILE);
        expect(files[0].truncated).toBe(true);
    });
});

describe('isTextAttachment', () => {
    const buf = (s: string): Buffer => Buffer.from(s, 'utf8');

    it('text/* 또는 텍스트 계열 application 타입이면 확장자와 무관하게 텍스트', () => {
        expect(isTextAttachment('noext', 'text/plain', buf('hi'))).toBe(true);
        expect(isTextAttachment('data', 'application/json', buf('{"a":1}'))).toBe(true);
        expect(isTextAttachment('x', 'application/x-ndjson', buf('{}\n{}'))).toBe(true);
    });

    it('타입이 없거나 일반 바이너리 타입이어도 확장자가 목록에 있으면 텍스트', () => {
        expect(isTextAttachment('conf.YAML', undefined, buf('a: 1'))).toBe(true);
        expect(isTextAttachment('run.py', 'application/octet-stream', buf('print(1)'))).toBe(true);
    });

    it('타입·확장자 모두 텍스트가 아니면 내용이 텍스트여도 거짓', () => {
        expect(isTextAttachment('blob.bin', 'application/octet-stream', buf('hello'))).toBe(false);
        expect(isTextAttachment('noext', undefined, buf('hello'))).toBe(false);
    });

    it('NUL 바이트나 UTF-8 디코딩 실패가 있으면 거짓', () => {
        expect(isTextAttachment('a.txt', 'text/plain', Buffer.from([0x68, 0x00]))).toBe(false);
        expect(isTextAttachment('a.txt', 'text/plain', Buffer.from([0xc3, 0x28]))).toBe(false);
    });
});
