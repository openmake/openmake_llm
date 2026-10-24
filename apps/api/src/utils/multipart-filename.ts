/**
 * multipart 파일명 복원 — busboy 는 multipart 파일명을 latin1 로 디코드하므로
 * UTF-8 한글 파일명이 `ë²¤ì²˜…` 처럼 깨진다. 그 문자열을 원래 UTF-8 로 되돌린다.
 *
 * @module utils/multipart-filename
 */

/**
 * busboy 가 latin1 로 넘긴 파일명을 UTF-8 로 복원한다.
 * 고문자(U+0080~U+00FF)가 없으면 무변환(ASCII·이미 UTF-8 인 한글),
 * 복원 결과에 U+FFFD 가 생기면 latin1 재해석이 틀린 것이므로 원본을 유지한다.
 * 이미 저장된 이름을 고치는 knowledge-runtime 마이그레이션 005(005_document_name_utf8_repair.sql)가
 * 같은 판별 규칙을 SQL 로 옮겨 쓴다 — 한쪽을 바꾸면 함께 바꾼다.
 */
export function decodeMultipartFilename(name: string): string {
    if (!/[\u0080-ÿ]/.test(name)) return name;
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('�') ? name : decoded;
}
