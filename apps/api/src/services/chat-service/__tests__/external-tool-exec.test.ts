/**
 * executeExternalTool — 채팅 경로 도구 결과를 LLM 컨텍스트 문자열로 바꾸는 규칙 (2026-09-15).
 *
 * 배경: content 배열을 통째로 JSON.stringify 해 8000자에서 잘랐다. open-design list_projects 원문은
 * 7,765자인데 이스케이프로 8,676자가 돼 19개 중 마지막 프로젝트가 잘렸다. text 는 그대로 잇는다.
 */
const executeToolWithContext = jest.fn();
const recordToolResultTruncation = jest.fn();

jest.mock('../../../mcp/unified-client', () => ({ getUnifiedMCPClient: () => ({ executeToolWithContext }) }));
jest.mock('../../tool-result-truncation-recorder', () => ({ recordToolResultTruncation }));

import { executeExternalTool } from '../external-tool-exec';
import { MAX_TOOL_RESULT_CHARS } from '../../../config/runtime-limits';

const deps = { currentUserContext: { userId: '3', role: 'user' }, allowedTools: [] } as never;

beforeEach(() => {
    executeToolWithContext.mockReset();
    recordToolResultTruncation.mockReset();
});

describe('executeExternalTool — 결과 문자열 변환', () => {
    it('text 결과는 이스케이프 없이 원문 그대로 돌려준다', async () => {
        const text = JSON.stringify({ projects: [{ id: 'a', name: 'OpenMake "LUMEN"' }] }, null, 2);
        executeToolWithContext.mockResolvedValue({ content: [{ type: 'text', text }] });

        const out = await executeExternalTool(deps, 'open-design::list_projects', {});

        expect(out).toBe(text);
        expect(recordToolResultTruncation).toHaveBeenCalledWith(expect.objectContaining({ rawChars: text.length }));
    });

    it('원문이 상한 안이면 줄바꿈·따옴표가 많아도 잘리지 않는다 (마지막 항목 보존)', async () => {
        const projects = Array.from({ length: 19 }, (_, i) => ({ id: `p${i}`, name: `"project-${i}"`, metadata: { skipDiscoveryBrief: true } }));
        let text = JSON.stringify({ projects }, null, 2);
        text += ' '.repeat(Math.max(0, MAX_TOOL_RESULT_CHARS - 50 - text.length));
        // 전제: 원문은 상한 안, content 배열 통째 직렬화는 상한 밖 — 종전 방식이면 마지막 항목이 잘린다
        expect(text.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
        expect(JSON.stringify([{ type: 'text', text }]).length).toBeGreaterThan(MAX_TOOL_RESULT_CHARS);
        executeToolWithContext.mockResolvedValue({ content: [{ type: 'text', text }] });

        const out = await executeExternalTool(deps, 'open-design::list_projects', {});

        expect(out).toBe(text);
        expect(out).toContain('project-18');
    });

    it('여러 text 는 줄바꿈으로 잇고 비텍스트 항목은 JSON 으로 남긴다', async () => {
        const image = { type: 'image', data: 'AAAA', mimeType: 'image/png' };
        executeToolWithContext.mockResolvedValue({ content: [{ type: 'text', text: 'first' }, image, { type: 'text', text: 'second' }] });

        const out = await executeExternalTool(deps, 'x::y', {});

        expect(out).toBe(`first\n${JSON.stringify(image)}\nsecond`);
    });

    it('상한을 넘으면 MAX_TOOL_RESULT_CHARS 에서 자른다', async () => {
        executeToolWithContext.mockResolvedValue({ content: [{ type: 'text', text: 'x'.repeat(MAX_TOOL_RESULT_CHARS + 500) }] });

        const out = await executeExternalTool(deps, 'x::y', {});

        expect(out).toHaveLength(MAX_TOOL_RESULT_CHARS);
        expect(recordToolResultTruncation).toHaveBeenCalledWith(expect.objectContaining({ rawChars: MAX_TOOL_RESULT_CHARS + 500 }));
    });

    it('상한 밖에 있는 kakaomap 블록은 앞에 따로 붙여 보존한다', async () => {
        const block = '```kakaomap\n{"places":[]}\n```';
        executeToolWithContext.mockResolvedValue({ content: [{ type: 'text', text: `${'y'.repeat(MAX_TOOL_RESULT_CHARS)}\n${block}` }] });

        const out = await executeExternalTool(deps, 'kakao::search-places', {});

        expect(out.startsWith(`${block}\n\n`)).toBe(true);
    });
});

describe('executeExternalTool — 웹검색 출처 전달(F19.4)', () => {
    const sources = [{ n: 1, title: 'T', url: 'https://e.example', snippet: 's' }];

    it('sources 가 있으면 resource 가 없어도 콜백에 싣고, 모델에는 text 만 간다', async () => {
        const mcpToolResultCallback = jest.fn();
        executeToolWithContext.mockResolvedValue({ content: [{ type: 'text', text: '[1] T' }], sources });
        const out = await executeExternalTool({ ...(deps as object), mcpToolResultCallback } as never, 'web_search', { query: 'q' });
        expect(out).toBe('[1] T');
        expect(mcpToolResultCallback).toHaveBeenCalledWith({ toolName: 'web_search', resources: [], sources });
    });

    it('sources·resource 둘 다 없으면 콜백하지 않는다', async () => {
        const mcpToolResultCallback = jest.fn();
        executeToolWithContext.mockResolvedValue({ content: [{ type: 'text', text: 'plain' }], sources: [] });
        await executeExternalTool({ ...(deps as object), mcpToolResultCallback } as never, 'x', {});
        expect(mcpToolResultCallback).not.toHaveBeenCalled();
    });
});
