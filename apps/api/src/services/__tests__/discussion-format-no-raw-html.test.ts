/**
 * 토론 결과 본문에 raw HTML 이 섞이지 않는지 회귀 테스트.
 *
 * 프론트 마크다운 렌더러는 XSS 방어로 rehype-raw 를 쓰지 않는다(의도된 설계).
 * 서버가 `<details open><summary>…` 로 감싸던 동안 태그는 렌더되지 않고 닫는 `</details>` 가
 * 본문에 그대로 노출됐다(2026-09-13 라이브 점검). 채팅 본문은 마크다운만 쓴다.
 */
import * as fs from 'fs';
import * as path from 'path';

describe('토론 결과 포맷터', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'chat-service-formatters.ts'), 'utf-8');
    // 주석(설명용 언급)은 제외하고 실제 문자열 리터럴만 본다
    const code = source
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');

    it('채팅 본문 조립에 raw HTML 태그를 넣지 않는다', () => {
        expect(code).not.toMatch(/formatted \+=[^\n]*<\/?(details|summary|div|span|br)\b/);
    });

    it('종합 답변은 마크다운 헤딩으로 구분한다', () => {
        expect(code).toMatch(/formatted \+= '## .*종합 답변/);
    });
});
