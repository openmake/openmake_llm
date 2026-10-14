/**
 * 채팅 턴 첨부 → 위임 작업 입력 변환 (2026-10-15).
 * 문서 추출이 data 를 지우기 전에 보관한 원본을 되살려 작업 생성 라우트와 같은 모양으로 만든다.
 */
import { buildTurnAttachments } from '../turn-attachments';

describe('buildTurnAttachments', () => {
    it('추출 전 원본 data 를 보존하고 추출된 문서에 extracted 를 표시한다', () => {
        const files = [
            { name: 'a.pdf', type: 'application/pdf', size: 100, content: '추출 본문', truncated: false },
            { name: 'b.txt', type: 'text/plain', size: 5, content: 'hello' },
        ];
        const result = buildTurnAttachments(files, undefined, ['JVBERi0=', undefined]);
        expect(result).toEqual({
            files: [
                { name: 'a.pdf', type: 'application/pdf', size: 100, content: '추출 본문', truncated: false, data: 'JVBERi0=', extracted: true },
                { name: 'b.txt', type: 'text/plain', size: 5, content: 'hello', truncated: undefined },
            ],
        });
    });

    it('추출에 실패해 content 가 없으면 원본만 넘기고 extracted 는 붙이지 않는다', () => {
        const result = buildTurnAttachments([{ name: 'scan.pdf', type: 'application/pdf', size: 9 }], undefined, ['JVBERi0=']);
        expect(result?.files?.[0]).toEqual(expect.objectContaining({ name: 'scan.pdf', data: 'JVBERi0=' }));
        expect(result?.files?.[0].extracted).toBeUndefined();
    });

    it('텍스트 파일을 디코딩한 content 에는 extracted 를 붙이지 않는다 — 원본이 곧 텍스트', () => {
        const result = buildTurnAttachments(
            [{ name: 'sales.csv', type: 'text/csv', size: 8, content: 'a,b\n1,2' }], undefined, ['YSxiCjEsMg=='],
        );
        expect(result?.files?.[0]).toEqual(expect.objectContaining({ name: 'sales.csv', data: 'YSxiCjEsMg==', content: 'a,b\n1,2' }));
        expect(result?.files?.[0].extracted).toBeUndefined();
    });

    it('웹소켓 첨부의 id 는 넘기지 않는다', () => {
        const result = buildTurnAttachments([{ id: 'f1', name: 'b.txt', type: 'text/plain', content: 'x' }], undefined);
        expect(result?.files?.[0]).not.toHaveProperty('id');
    });

    it('이미지는 data URL 로 넘긴다 — raw base64 는 감싸고, 외부 URL 은 뺀다', () => {
        const result = buildTurnAttachments(undefined, ['/9j/4AAQ', 'data:image/png;base64,iVBORw0KGgo=', 'https://example.com/a.png']);
        expect(result).toEqual({ images: ['data:image/jpeg;base64,/9j/4AAQ', 'data:image/png;base64,iVBORw0KGgo='] });
    });

    it('파일·이미지가 둘 다 없으면 undefined', () => {
        expect(buildTurnAttachments(undefined, undefined)).toBeUndefined();
        expect(buildTurnAttachments([], [])).toBeUndefined();
    });
});
