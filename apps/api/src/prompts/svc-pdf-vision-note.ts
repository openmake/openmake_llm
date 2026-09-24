/**
 * ============================================================
 * PDF Vision Note — 첨부 PDF 페이지 이미지 안내문
 * ============================================================
 *
 * services/chat-service/pdf-vision 이 렌더한 PDF 앞쪽 페이지 이미지를 컨텍스트에 주입할 때
 * 본문 앞에 붙이는 안내문. 모델이 표·차트·레이아웃 판독을 이미지 근거로 하도록 유도한다.
 *
 * @module prompts/svc-pdf-vision-note
 */

/**
 * PDF 페이지 이미지 주입 안내문 조립.
 * @param noteLines 파일별 페이지 첨부 요약 라인들
 */
export function buildPdfVisionNote(noteLines: string[]): string {
    return (
        '\n\n[첨부 PDF 페이지 이미지] 아래 PDF 는 본문 텍스트 추출과 별도로 앞쪽 페이지가 이미지로도 첨부되어 있다. ' +
        '표·차트·레이아웃이 필요한 판독은 이미지를 근거로 할 것.\n' +
        noteLines.join('\n')
    );
}
