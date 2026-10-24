/**
 * toolContentToText — 도구 결과 content 를 모델에 줄 텍스트로 바꾸는 규칙 (2026-10-24).
 *
 * 배경: content 배열을 통째로 JSON.stringify 해 `Error: [{"type":"text","text":"오류: …"}]` 처럼
 * 모델·작업 스텝에 JSON 이 노출됐다. text 항목은 원문 그대로 잇고 비텍스트 항목만 JSON 으로 싣는다.
 */
import { toolContentToText } from '../tool-content-text';
import type { MCPToolResult } from '../types';

describe('toolContentToText', () => {
    it('문자열은 그대로 돌려준다', () => {
        expect(toolContentToText('그대로 "원문"\n둘째 줄')).toBe('그대로 "원문"\n둘째 줄');
    });

    it('text 항목은 이스케이프 없이 줄바꿈으로 잇는다', () => {
        const content: MCPToolResult['content'] = [
            { type: 'text', text: '오류: getaddrinfo ENOTFOUND "x"' },
            { type: 'text', text: '[오류 유형: provider, 재시도 가능]' },
        ];
        expect(toolContentToText(content)).toBe('오류: getaddrinfo ENOTFOUND "x"\n[오류 유형: provider, 재시도 가능]');
    });

    it('비텍스트 항목은 JSON 으로 싣는다', () => {
        const image = { type: 'image' as const, data: 'AAAA', mimeType: 'image/png' };
        const resource = { type: 'resource' as const, resource: { uri: 'file:///a.txt', text: 'a' } };
        expect(toolContentToText([{ type: 'text', text: 'first' }, image, resource]))
            .toBe(`first\n${JSON.stringify(image)}\n${JSON.stringify(resource)}`);
    });

    it('빈 배열은 빈 문자열이다', () => {
        expect(toolContentToText([])).toBe('');
    });

    it('text 가 없는 text 항목은 JSON 으로 싣는다', () => {
        const noText = { type: 'text' as const };
        expect(toolContentToText([noText, { type: 'text', text: 'ok' }])).toBe(`${JSON.stringify(noText)}\nok`);
    });
});
