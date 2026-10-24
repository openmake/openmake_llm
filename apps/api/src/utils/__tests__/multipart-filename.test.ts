/** multipart 파일명 복원 — busboy 가 latin1 로 디코드한 UTF-8 파일명을 되돌리는 순수 함수 */
import { decodeMultipartFilename } from '../multipart-filename';

/** UTF-8 바이트를 latin1 로 읽은 것처럼 깨뜨린다(busboy 기본 동작 재현) */
const garble = (s: string): string => Buffer.from(s, 'utf8').toString('latin1');

describe('decodeMultipartFilename', () => {
    it('ASCII 파일명은 그대로 둔다', () => {
        expect(decodeMultipartFilename('report-2026.txt')).toBe('report-2026.txt');
    });

    it('latin1 로 깨진 한글 파일명을 UTF-8 로 복원한다', () => {
        expect(decodeMultipartFilename(garble('벤처 보고서.txt'))).toBe('벤처 보고서.txt');
    });

    it('이미 UTF-8 인 한글 파일명은 그대로 둔다', () => {
        expect(decodeMultipartFilename('벤처 보고서.txt')).toBe('벤처 보고서.txt');
    });

    it('복원 결과에 U+FFFD 가 생기면 원본을 유지한다', () => {
        // 정상 디코드된 latin1 문자(é) — latin1→utf8 재해석은 잘못된 바이트열이 된다
        expect(decodeMultipartFilename('café.txt')).toBe('café.txt');
    });
});
