/**
 * 개발자 문서 API 회귀 — 사용자가 그대로 복사하는 값에 플레이스홀더·미치환 표현이 없어야 한다.
 *
 * 2026-09-13 라이브: `https://your-domain` 을 정리하면서 일부 curl 문자열을 템플릿 리터럴로
 * 바꾸지 못해 응답에 `${base}` 가 **문자열 그대로** 나갔다(배포 후 실측).
 */
import * as fs from 'fs';
import * as path from 'path';

describe('developer-docs 라우트', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'developer-docs.routes.ts'), 'utf-8');

    it('curl 예시에 미치환 ${base} 가 남지 않는다 (템플릿 리터럴 사용)', () => {
        const curlLines = source.split('\n').filter((l) => l.includes('curl:'));
        expect(curlLines.length).toBeGreaterThan(0);
        for (const line of curlLines) {
            if (line.includes('${base}')) {
                // 템플릿 리터럴(백틱)로 감싼 경우만 허용
                expect(line).toMatch(/curl:\s*`/);
            }
        }
    });

    it('플레이스홀더 호스트를 쓰지 않는다', () => {
        const code = source.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
        expect(code).not.toContain('your-domain');
        expect(code).not.toContain('developer.html');
    });
});
