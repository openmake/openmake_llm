/**
 * 들어오는 첨부(사용자 → 봇) 변환 검증 — 상한 선별·분류·data URI·생략 안내·내려받기.
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
    collectInboundAttachments,
    formatSkippedNotice,
    INBOUND_LIMITS,
    selectWithinLimits,
    toImageDataUri,
    toPayloadItem,
    type InboundAttachmentMeta,
} from './inbound-attachments';

const MB = 1024 * 1024;
const meta = (name: string, size: number, contentType: string | null = 'application/pdf'): InboundAttachmentMeta => ({
    name, size, contentType, url: `https://cdn.example/${name}`,
});

test('상한은 개별 8MB·합계 20MB·개수 10', () => {
    assert.equal(INBOUND_LIMITS.MAX_FILE_BYTES, 8 * MB);
    assert.equal(INBOUND_LIMITS.MAX_TOTAL_BYTES, 20 * MB);
    assert.equal(INBOUND_LIMITS.MAX_COUNT, 10);
});

test('selectWithinLimits: 개별 상한 초과는 건너뛴다', () => {
    const r = selectWithinLimits([meta('a.pdf', 1 * MB), meta('big.zip', 9 * MB)]);
    assert.deepEqual(r.accepted.map((m) => m.name), ['a.pdf']);
    assert.deepEqual(r.skipped, ['big.zip']);
});

test('selectWithinLimits: 합계 상한을 넘기는 항목은 건너뛰고 뒤의 작은 항목은 받는다', () => {
    const r = selectWithinLimits([meta('a', 8 * MB), meta('b', 8 * MB), meta('c', 7 * MB), meta('d', 4 * MB)]);
    assert.deepEqual(r.accepted.map((m) => m.name), ['a', 'b', 'd']);
    assert.deepEqual(r.skipped, ['c']);
});

test('selectWithinLimits: 개수 상한 초과분은 건너뛴다', () => {
    const metas = Array.from({ length: 12 }, (_, i) => meta(`f${i}.txt`, 10));
    const r = selectWithinLimits(metas);
    assert.equal(r.accepted.length, 10);
    assert.deepEqual(r.skipped, ['f10.txt', 'f11.txt']);
});

test('toImageDataUri: data:<mime>;base64,<...>', () => {
    assert.equal(toImageDataUri('image/png', Buffer.from('abc')), 'data:image/png;base64,YWJj');
});

test('toPayloadItem: image/* 는 image_url part 로', () => {
    const item = toPayloadItem(meta('p.png', 3, 'image/png'), Buffer.from('abc'));
    assert.deepEqual(item, { kind: 'image', part: { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } } });
});

test('toPayloadItem: contentType 의 charset 등 파라미터는 data URI 에서 뺀다', () => {
    const item = toPayloadItem(meta('p.jpg', 3, 'image/jpeg; charset=binary'), Buffer.from('abc'));
    assert.equal(item.kind, 'image');
    assert.equal(item.kind === 'image' && item.part.image_url.url, 'data:image/jpeg;base64,YWJj');
});

test('toPayloadItem: 그 외(문서·contentType 없음)는 files 항목으로', () => {
    const doc = toPayloadItem(meta('r.pdf', 3, 'application/pdf'), Buffer.from('abc'));
    assert.deepEqual(doc, { kind: 'file', file: { name: 'r.pdf', type: 'application/pdf', size: 3, data: 'YWJj' } });
    const unknown = toPayloadItem(meta('x.bin', 3, null), Buffer.from('abc'));
    assert.deepEqual(unknown, { kind: 'file', file: { name: 'x.bin', size: 3, data: 'YWJj' } });
});

test('formatSkippedNotice: 생략 없으면 빈 문자열, 있으면 한 줄', () => {
    assert.equal(formatSkippedNotice([]), '');
    assert.equal(formatSkippedNotice(['a.pdf', 'b.zip']), '⚠️ 첨부 생략(크기 초과 또는 내려받기 실패): a.pdf, b.zip');
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('collectInboundAttachments: 내려받아 분류하고, 실패·상한 초과는 skipped 로', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/broken.pdf')) return new Response('nope', { status: 404 });
        return new Response(Buffer.from('abc'));
    }) as typeof fetch;
    const r = await collectInboundAttachments([
        meta('p.png', 3, 'image/png'),
        meta('r.pdf', 3),
        meta('broken.pdf', 3),
        meta('huge.zip', 9 * MB, 'application/zip'),
    ]);
    assert.equal(r.imageParts.length, 1);
    assert.equal(r.imageParts[0].image_url.url, 'data:image/png;base64,YWJj');
    assert.deepEqual(r.files, [{ name: 'r.pdf', type: 'application/pdf', size: 3, data: 'YWJj' }]);
    assert.deepEqual(r.skipped.sort(), ['broken.pdf', 'huge.zip']);
});

test('collectInboundAttachments: 실제 바이트가 개별 상한을 넘으면 건너뛴다(선언 크기 불일치 방어)', async () => {
    globalThis.fetch = (async () => new Response(Buffer.alloc(INBOUND_LIMITS.MAX_FILE_BYTES + 1))) as typeof fetch;
    const r = await collectInboundAttachments([meta('liar.pdf', 3)]);
    assert.deepEqual(r.files, []);
    assert.deepEqual(r.skipped, ['liar.pdf']);
});
