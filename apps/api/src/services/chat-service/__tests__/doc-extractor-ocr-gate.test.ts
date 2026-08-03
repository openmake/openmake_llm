/**
 * doc-extractor OCR 게이트 유닛 테스트 — isExtractableSize 단일 규칙 검증.
 * (라우트 multipart·chunk-store claim·본문 루프가 이 규칙 하나를 공유 — 비대칭 회귀 방지)
 */
import { isExtractableSize } from '../doc-extractor';
import { DOC_EXTRACT_LIMITS } from '../../../config/runtime-limits';

const FULL = DOC_EXTRACT_LIMITS.MAX_BYTES_PER_FILE;
const OCR_MAX = DOC_EXTRACT_LIMITS.OCR_MAX_BYTES;

describe('isExtractableSize', () => {
    it('일반 상한 이내면 확장자 무관 허용', () => {
        expect(isExtractableSize('a.docx', FULL)).toBe(true);
        expect(isExtractableSize('a.pdf', 1)).toBe(true);
    });

    it('빈/음수 크기는 거절', () => {
        expect(isExtractableSize('a.pdf', 0)).toBe(false);
        expect(isExtractableSize('a.pdf', -1)).toBe(false);
    });

    it('일반 상한 초과 PDF 는 OCR 상한까지 허용 (OCR 직행 경로)', () => {
        expect(isExtractableSize('scan.pdf', FULL + 1)).toBe(DOC_EXTRACT_LIMITS.OCR_ENABLED);
        expect(isExtractableSize('scan.pdf', OCR_MAX)).toBe(DOC_EXTRACT_LIMITS.OCR_ENABLED);
        expect(isExtractableSize('scan.pdf', OCR_MAX + 1)).toBe(false);
    });

    it('일반 상한 초과 비-PDF 는 거절 (JVM/파서 보호 유지)', () => {
        expect(isExtractableSize('big.docx', FULL + 1)).toBe(false);
        expect(isExtractableSize('big.xlsx', OCR_MAX)).toBe(false);
    });

    it('대소문자 확장자 무관', () => {
        expect(isExtractableSize('SCAN.PDF', FULL + 1)).toBe(DOC_EXTRACT_LIMITS.OCR_ENABLED);
    });
});
