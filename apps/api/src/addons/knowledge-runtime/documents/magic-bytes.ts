/**
 * 업로드 매직 바이트 검사 — 신고 MIME 과 파일 앞부분이 어긋나면 파서가 돌기 전에 거부한다(외부 의존성 없이 아래 표가 전부).
 * 표에 없는 MIME(텍스트류 등)은 매직이 없으므로 검사하지 않는다.
 *
 * @module addons/knowledge-runtime/documents/magic-bytes
 */

/** 앞부분 검사에 읽는 바이트 수. */
export const MAGIC_HEAD_BYTES = 8;

const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** 정확한 MIME → 매직 접두사. */
const MAGIC_BY_MIME: Readonly<Record<string, Buffer>> = {
    'application/pdf': Buffer.from('%PDF-', 'latin1'),
    'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
    'application/zip': Buffer.from('PK', 'latin1'),
};

/** MIME 접두사 → 매직(docx/xlsx/pptx 등 OOXML 은 ZIP 로컬 헤더). */
const MAGIC_BY_MIME_PREFIX: ReadonlyArray<readonly [string, Buffer]> = [
    ['application/vnd.openxmlformats-', ZIP_LOCAL_HEADER],
];

function magicFor(mime: string): Buffer | null {
    const exact = MAGIC_BY_MIME[mime];
    if (exact) return exact;
    const byPrefix = MAGIC_BY_MIME_PREFIX.find(([prefix]) => mime.startsWith(prefix));
    return byPrefix ? byPrefix[1] : null;
}

/**
 * 앞부분이 신고 MIME 의 매직과 어긋나면 true. 표에 없는 MIME 은 false.
 * 앞부분이 매직보다 짧으면 있는 바이트만 비교한다 — 이미 어긋난 바이트가 있을 때만 불일치(빈 파일은 여기서 거부하지 않는다).
 */
export function sniffMimeMismatch(head: Buffer, mime: string): boolean {
    const magic = magicFor(mime);
    if (!magic) return false;
    const n = Math.min(head.length, magic.length);
    return !head.subarray(0, n).equals(magic.subarray(0, n));
}
