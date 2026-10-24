/**
 * executeExternalTool isError 결과 문자열(2026-10-24) — content 배열을 JSON 이 아닌 텍스트로 모델에 넘긴다.
 * 종전 isError 분기만 배열을 통째로 JSON.stringify 해 `Error: [{"type":"text",…}]` 가 모델 입력에 보였다.
 */
const executeTool = jest.fn();
const recordToolResultTruncation = jest.fn();

jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({ executeTool }),
}));
jest.mock('../../tool-result-truncation-recorder', () => ({ recordToolResultTruncation }));

import { executeExternalTool } from '../external-tool-exec';

const deps = { currentUserContext: { userId: '3', role: 'user' }, allowedTools: [] } as never;

beforeEach(() => {
    executeTool.mockReset();
    recordToolResultTruncation.mockReset();
});

describe('executeExternalTool — 오류 결과 텍스트', () => {
    it('isError 배열의 text 항목은 JSON 없이 Error: 접두로 돌려준다', async () => {
        executeTool.mockResolvedValue({
            content: [{ type: 'text', text: '오류: getaddrinfo ENOTFOUND x\n[오류 유형: provider, 재시도 가능]' }],
            isError: true,
        });

        const out = await executeExternalTool(deps, 'x::y', {});

        expect(out).toBe('Error: 오류: getaddrinfo ENOTFOUND x\n[오류 유형: provider, 재시도 가능]');
        expect(out).not.toContain('[{');
    });

    it('isError 문자열 content 는 그대로 Error: 접두로 돌려준다', async () => {
        executeTool.mockResolvedValue({ content: '오류: 실패', isError: true });

        const out = await executeExternalTool(deps, 'x::y', {});

        expect(out).toBe('Error: 오류: 실패');
    });
});
